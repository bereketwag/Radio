from rest_framework import serializers

from apps.common.utils import probe_stored_audio_duration
from apps.common.validators import validate_audio_upload, validate_image_upload

from .models import (
    AdBreakLog,
    AdRequest,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    ImpressionEvent,
    PaymentStatus,
    VisualCampaign,
)


class AdvertiserSerializer(serializers.ModelSerializer):
    visual_campaigns_count = serializers.SerializerMethodField()
    audio_campaigns_count = serializers.SerializerMethodField()

    class Meta:
        model = Advertiser
        fields = [
            "id", "owner", "name", "contact_name", "email", "phone", "website", "notes",
            "created_at", "updated_at", "visual_campaigns_count", "audio_campaigns_count",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_visual_campaigns_count(self, obj) -> int:
        return obj.visual_campaigns.count()

    def get_audio_campaigns_count(self, obj) -> int:
        return obj.audio_campaigns.count()


class AdRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdRequest
        fields = [
            "id", "business_name", "contact_name", "email", "phone", "website", "ad_format",
            "start_date", "end_date", "target_audience", "estimated_budget", "message",
            "status", "status_note", "handled_by", "handled_at", "created_at",
        ]
        read_only_fields = ["id", "status", "status_note", "handled_by", "handled_at", "created_at"]

    def to_internal_value(self, data):
        """Treat empty-string optionals as absent.

        A browser form (or any JSON client) sends "" for an untouched optional
        field. DRF's DateField rejects "" outright, so strip blank scalars
        before validation — the public form's optional dates must not 400.
        """
        if hasattr(data, "copy") and not isinstance(data, dict):
            data = data.copy()
        elif isinstance(data, dict):
            data = {k: v for k, v in data.items() if not (isinstance(v, str) and v == "" and k != "message")}
        cleaned = {}
        for key, value in data.items():
            if isinstance(value, str) and value == "" and key in ("phone", "website", "start_date", "end_date"):
                continue
            cleaned[key] = value
        return super().to_internal_value(cleaned)

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date must be on or after the start date."})
        return attrs


class VisualCampaignSerializer(serializers.ModelSerializer):
    advertiser_name = serializers.CharField(source="advertiser.name", read_only=True)
    eligible = serializers.SerializerMethodField()
    ctr = serializers.SerializerMethodField()

    class Meta:
        model = VisualCampaign
        fields = [
            "id", "advertiser", "advertiser_name", "name", "banner_image", "destination_url",
            "placement", "priority", "status", "payment_status", "starts_at", "ends_at",
            "impressions", "clicks", "ctr", "eligible", "request", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "impressions", "clicks", "created_at", "updated_at"]

    def get_eligible(self, obj) -> bool:
        return obj.is_eligible()

    def validate_banner_image(self, value):
        # A missing creative is allowed (draft shell); a provided one must pass
        # the station's image rules.
        if value is None:
            return value
        validate_image_upload(value)
        return value

    def get_ctr(self, obj) -> float | None:
        if obj.impressions == 0:
            return None  # measured data only — never invent a rate
        return round(obj.clicks / obj.impressions * 100, 2)


class AudioAdvertSerializer(serializers.ModelSerializer):
    audio_url = serializers.SerializerMethodField()
    # Same multipart trap as the music library: a checkbox the form omits
    # would otherwise read as False and deactivate every uploaded spot.
    approved = serializers.BooleanField(required=False, default=AudioAdvert._meta.get_field("approved").default)
    active = serializers.BooleanField(required=False, default=AudioAdvert._meta.get_field("active").default)

    class Meta:
        model = AudioAdvert
        fields = ["id", "name", "audio_file", "audio_url", "duration_seconds", "approved", "active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_audio_url(self, obj) -> str | None:
        return obj.audio_file.url if obj.audio_file else None

    def validate_audio_file(self, value):
        validate_audio_upload(value)
        return value

    def _probe_duration(self, instance: AudioAdvert, force: bool = False) -> AudioAdvert:
        """Measure the spot from the file so break budgets stay accurate."""
        if instance.audio_file and (force or not instance.duration_seconds):
            probed = probe_stored_audio_duration(instance.audio_file)
            if probed:
                AudioAdvert.objects.filter(pk=instance.pk).update(duration_seconds=probed)
                instance.duration_seconds = probed
        return instance

    def create(self, validated_data):
        advert = super().create(validated_data)
        return self._probe_duration(advert, force=True)

    def update(self, instance, validated_data):
        audio_replaced = "audio_file" in validated_data
        advert = super().update(instance, validated_data)
        return self._probe_duration(advert, force=audio_replaced)


class AdScheduleSerializer(serializers.ModelSerializer):
    conflicts = serializers.SerializerMethodField()

    class Meta:
        model = AdSchedule
        fields = [
            "id", "campaign", "recurrence", "starts_at", "local_time", "weekday",
            "max_break_seconds", "enabled", "last_run_at", "conflicts",
        ]
        read_only_fields = ["id", "last_run_at", "conflicts"]

    def get_conflicts(self, obj) -> list:
        from . import services

        return services.find_schedule_conflicts(obj.campaign, obj)

    def validate(self, attrs):
        recurrence = attrs.get("recurrence", getattr(self.instance, "recurrence", None))
        weekday = attrs.get("weekday", getattr(self.instance, "weekday", None))
        local_time = attrs.get("local_time", getattr(self.instance, "local_time", None))
        if recurrence == AdSchedule.Recurrence.ONCE and not attrs.get("starts_at", getattr(self.instance, "starts_at", None)):
            raise serializers.ValidationError({"starts_at": "One-time schedules need an exact start time."})
        if recurrence == AdSchedule.Recurrence.WEEKLY and weekday is None:
            raise serializers.ValidationError({"weekday": "Weekly schedules need a weekday (0=Monday)."})
        if recurrence in (AdSchedule.Recurrence.DAILY, AdSchedule.Recurrence.WEEKLY) and local_time is None:
            raise serializers.ValidationError({"local_time": "Recurring schedules need a station-local time."})
        return attrs


class AudioCampaignSerializer(serializers.ModelSerializer):
    advertiser_name = serializers.CharField(source="advertiser.name", read_only=True)
    adverts = AudioAdvertSerializer(many=True, read_only=True)
    advert_ids = serializers.PrimaryKeyRelatedField(
        queryset=AudioAdvert.objects.all(), many=True, source="adverts", write_only=True, required=False
    )
    schedules = AdScheduleSerializer(many=True, read_only=True)
    eligible = serializers.SerializerMethodField()

    class Meta:
        model = AudioCampaign
        fields = [
            "id", "advertiser", "advertiser_name", "name", "status", "payment_status",
            "starts_at", "ends_at", "priority", "adverts", "advert_ids", "schedules",
            "eligible", "request", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_eligible(self, obj) -> bool:
        return obj.is_eligible()


class AdBreakLogSerializer(serializers.ModelSerializer):
    campaign_name = serializers.CharField(source="campaign.name", read_only=True)
    advert_names = serializers.SerializerMethodField()

    class Meta:
        model = AdBreakLog
        fields = [
            "id", "campaign", "campaign_name", "scheduled_for", "started_at", "finished_at",
            "result", "seconds_played", "advert_names", "detail",
        ]

    def get_advert_names(self, obj) -> list[str]:
        return list(obj.adverts_played.values_list("name", flat=True))


class VisualCampaignPublicSerializer(serializers.ModelSerializer):
    """Shape served to the public rotation panel (no admin fields)."""

    advertiser_name = serializers.CharField(source="advertiser.name", read_only=True)
    banner_url = serializers.SerializerMethodField()

    class Meta:
        model = VisualCampaign
        fields = ["id", "name", "advertiser_name", "banner_url", "destination_url", "placement"]

    def get_banner_url(self, obj) -> str | None:
        return obj.banner_image.url if obj.banner_image else None

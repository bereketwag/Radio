import json

from rest_framework import serializers

from apps.common.utils import probe_stored_audio_duration
from apps.common.validators import validate_audio_upload, validate_image_upload

from .models import BroadcastHistory, OffAirTrack, Playlist, PlaylistEntry, Track


class TerritoriesField(serializers.JSONField):
    """ISO country codes as a list, tolerant of the shapes a form can send.

    Accepts `["US", "DE"]`, a JSON-encoded string, or the plain "us, de" text
    an admin types into a single input — and stores one canonical list.
    """

    def to_internal_value(self, data):
        if isinstance(data, str):
            text = data.strip()
            try:
                data = json.loads(text)
            except ValueError:
                data = [part for part in text.split(",") if part.strip()]
        if isinstance(data, list):
            return [str(part).strip().upper() for part in data if str(part).strip()]
        raise serializers.ValidationError("Expected a list of ISO country codes.")


class TrackSerializer(serializers.ModelSerializer):
    artwork_url = serializers.SerializerMethodField()
    audio_url = serializers.SerializerMethodField()
    territories_display = serializers.CharField(read_only=True)
    permitted_territories = TerritoriesField(required=False)
    # DRF reads a boolean missing from a *multipart* body as False (unchecked
    # HTML checkbox), which would silently create every upload as disabled.
    # Pin them to the model defaults: omitting the field means "leave it at
    # the default", sending "false" still unchecks it. PATCH skips absent
    # fields regardless, so an edit never flips them by accident.
    enabled = serializers.BooleanField(required=False, default=Track._meta.get_field("enabled").default)
    explicit = serializers.BooleanField(required=False, default=Track._meta.get_field("explicit").default)

    class Meta:
        model = Track
        fields = [
            "id", "title", "artist", "album", "audio_file", "audio_url", "duration_seconds",
            "artwork", "artwork_url", "enabled", "isrc", "label", "licensing_notes",
            "permitted_territories", "territories_display", "explicit", "created_at", "updated_at",
        ]

    def validate_audio_file(self, value):
        validate_audio_upload(value)
        return value

    def validate_artwork(self, value):
        if value:
            validate_image_upload(value)
        return value

    def get_artwork_url(self, obj) -> str | None:
        return obj.artwork.url if obj.artwork else None

    def get_audio_url(self, obj) -> str | None:
        return obj.audio_file.url if obj.audio_file else None

    def _probe_duration(self, instance: Track, force: bool = False) -> Track:
        """Fill duration from the uploaded file when it is missing or stale.

        Admins upload audio without knowing the exact length; probing keeps
        the library's minute totals honest instead of counting zero-length
        tracks. Replacing the file re-measures even if a duration exists —
        otherwise a swapped-in edit would keep the old track's length.
        """
        if instance.audio_file and (force or not instance.duration_seconds):
            probed = probe_stored_audio_duration(instance.audio_file)
            if probed:
                Track.objects.filter(pk=instance.pk).update(duration_seconds=probed)
                instance.duration_seconds = probed
        return instance

    def create(self, validated_data):
        track = super().create(validated_data)
        return self._probe_duration(track, force=True)

    def update(self, instance, validated_data):
        audio_replaced = "audio_file" in validated_data
        track = super().update(instance, validated_data)
        return self._probe_duration(track, force=audio_replaced)


class TrackListItemSerializer(serializers.ModelSerializer):
    artwork_url = serializers.SerializerMethodField()
    audio_url = serializers.SerializerMethodField()

    class Meta:
        model = Track
        fields = ["id", "title", "artist", "album", "duration_seconds", "artwork_url", "audio_url", "enabled"]

    def get_artwork_url(self, obj) -> str | None:
        return obj.artwork.url if obj.artwork else None

    def get_audio_url(self, obj) -> str | None:
        return obj.audio_file.url if obj.audio_file else None


class BroadcastHistorySerializer(serializers.ModelSerializer):
    track_title = serializers.CharField(source="track.title", read_only=True, default=None)
    artwork_url = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = BroadcastHistory
        fields = [
            "id", "kind", "title", "artist", "album", "started_at",
            "duration_seconds", "artwork_url", "is_current", "track_title",
        ]

    def get_artwork_url(self, obj) -> str | None:
        if obj.track and obj.track.artwork:
            return obj.track.artwork.url
        return None

    def get_is_current(self, obj) -> bool:
        current_id = self.context.get("current_history_id")
        return bool(current_id and obj.id == current_id)


class PlaylistEntrySerializer(serializers.ModelSerializer):
    track = TrackListItemSerializer(read_only=True)
    track_id = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(), source="track", write_only=True
    )

    class Meta:
        model = PlaylistEntry
        fields = ["id", "track", "track_id", "position"]


class PlaylistSerializer(serializers.ModelSerializer):
    entries = PlaylistEntrySerializer(many=True, read_only=True)

    class Meta:
        model = Playlist
        fields = ["id", "name", "description", "is_default", "is_fallback", "enabled", "entries"]


class OffAirTrackSerializer(serializers.ModelSerializer):
    """A waiting song for the off-air state (loops while the broadcast is off)."""

    audio_url = serializers.SerializerMethodField()

    class Meta:
        model = OffAirTrack
        fields = ["id", "title", "audio_file", "audio_url", "position", "created_at"]

    def validate_audio_file(self, value):
        validate_audio_upload(value)
        return value

    def get_audio_url(self, obj) -> str | None:
        return obj.audio_file.url if obj.audio_file else None

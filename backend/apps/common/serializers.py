from rest_framework import serializers

from .models import AuditLog, HealthEvent, StationSettings
from .validators import validate_audio_upload


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "actor_email", "action", "object_type", "object_id", "summary", "extra", "created_at"]


class HealthEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = HealthEvent
        fields = ["id", "source", "severity", "code", "message", "detail", "resolved", "created_at"]


class StationSettingsSerializer(serializers.ModelSerializer):
    """Admin-editable station branding + theme colour (blank = env default)."""

    fallback_audio_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = StationSettings
        fields = [
            "name", "tagline", "contact_email", "contact_address", "accent_color",
            "broadcast_enabled", "fallback_audio", "fallback_audio_url", "updated_at",
        ]
        read_only_fields = ["updated_at", "fallback_audio_url"]
        extra_kwargs = {"fallback_audio": {"required": False, "allow_null": True}}

    def get_fallback_audio_url(self, obj) -> str | None:
        return obj.fallback_audio.url if obj.fallback_audio else None

    def validate_fallback_audio(self, value):
        if value:
            validate_audio_upload(value)
        return value

from rest_framework import serializers

from .models import AuditLog, HealthEvent, StationSettings


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

    class Meta:
        model = StationSettings
        fields = ["name", "tagline", "contact_email", "contact_address", "accent_color", "updated_at"]
        read_only_fields = ["updated_at"]

import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


hex_color_validator = RegexValidator(
    r"^#[0-9a-fA-F]{6}$", "Use a hex colour like #169154."
)


class StationSettings(TimeStampedModel):
    """Singleton station branding + appearance, edited from the admin dashboard.

    Blank text fields fall back to the environment defaults in settings.py, so
    a fresh install looks right before anyone opens the dashboard — and an
    operator can override any of it without redeploying.
    """

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    name = models.CharField(max_length=120, blank=True, default="", help_text="Blank = STATION_NAME from the environment.")
    tagline = models.CharField(max_length=200, blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    contact_address = models.CharField(max_length=240, blank=True, default="")
    accent_color = models.CharField(
        max_length=7, default="#169154", validators=[hex_color_validator],
        help_text="Theme colour used for buttons, highlights, and the live indicator.",
    )
    broadcast_enabled = models.BooleanField(
        default=True,
        help_text="Off = the engine leaves the music rotation and loops the off-air audio instead.",
    )
    fallback_audio = models.FileField(
        upload_to="fallback/", blank=True, null=True,
        help_text="Off-air track played on repeat while the broadcast is off (empty = silence).",
    )

    class Meta:
        verbose_name = "station settings"

    def __str__(self) -> str:
        return f"Station settings ({self.name or settings.STATION_NAME})"

    @classmethod
    def get(cls) -> "StationSettings":
        row, _ = cls.objects.get_or_create(pk=1)
        return row


class AuditLog(models.Model):
    """Immutable trail of privileged administrative changes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    actor_email = models.CharField(max_length=254, blank=True, default="")
    action = models.CharField(max_length=64)  # e.g. campaign.approve
    object_type = models.CharField(max_length=64)
    object_id = models.CharField(max_length=64, blank=True, default="")
    summary = models.CharField(max_length=500, blank=True, default="")
    extra = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at", "object_type"])]

    def __str__(self) -> str:
        return f"{self.action} {self.object_type}#{self.object_id}"


class HealthEvent(models.Model):
    """Streaming/backend health observations surfaced in the admin dashboard."""

    class Severity(models.TextChoices):
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    class Source(models.TextChoices):
        BROADCAST = "broadcast", "Broadcast engine"
        ICECAST = "icecast", "Icecast"
        API = "api", "API"
        STREAM = "stream", "Stream listener"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.CharField(max_length=32, choices=Source.choices)
    severity = models.CharField(max_length=16, choices=Severity.choices, default=Severity.WARNING)
    code = models.CharField(max_length=64)  # e.g. metadata.heartbeat_stale
    message = models.TextField()
    detail = models.JSONField(default=dict, blank=True)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at", "resolved"])]

    def __str__(self) -> str:
        return f"[{self.severity}] {self.source}:{self.code}"


def record_health_event(source: str, code: str, message: str, severity: str = HealthEvent.Severity.WARNING, **detail) -> HealthEvent:
    """Create a health event, collapsing repeats of the same open code."""
    existing = (
        HealthEvent.objects.filter(source=source, code=code, resolved=False)
        .order_by("-created_at")
        .first()
    )
    if existing and existing.message == message:
        return existing  # don't spam duplicates while the issue persists
    return HealthEvent.objects.create(
        source=source, code=code, message=message, severity=severity, detail=detail
    )


def log_audit(actor, action: str, object_type: str, object_id: str = "", summary: str = "", **extra) -> AuditLog:
    return AuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_email=getattr(actor, "email", "") or "",
        action=action,
        object_type=object_type,
        object_id=str(object_id),
        summary=summary,
        extra=extra,
    )

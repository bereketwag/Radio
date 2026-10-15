import logging

from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.common.permissions import IsStationAdmin

from .models import StationSettings, log_audit
from .serializers import StationSettingsSerializer

logger = logging.getLogger("apps")


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Liveness + dependency readiness probe."""
    checks = {"database": False}
    try:
        connection.ensure_connection()
        checks["database"] = True
    except Exception as exc:  # pragma: no cover - depends on environment
        logger.warning("health check database failure: %s", exc)
    status = 200 if all(checks.values()) else 503
    return Response({"status": "ok" if status == 200 else "degraded", "checks": checks}, status=status)


@api_view(["GET"])
@permission_classes([AllowAny])
def station_config(request):
    """Public station branding/appearance consumed by the frontend shell.

    Values edited in the admin dashboard win; blank fields fall back to the
    environment defaults so a fresh install is never blank.
    """
    cfg = StationSettings.get()
    return Response(
        {
            "name": cfg.name or settings.STATION_NAME,
            "tagline": cfg.tagline or settings.STATION_TAGLINE,
            "timezone": settings.STATION_TIMEZONE,
            "contact_email": cfg.contact_email or settings.STATION_CONTACT_EMAIL,
            "contact_address": cfg.contact_address or settings.STATION_CONTACT_ADDRESS,
            "social": {k: v for k, v in settings.STATION_SOCIAL.items() if v},
            "accent_color": cfg.accent_color,
            "stream_url": settings.STREAM_PUBLIC_URL,
        }
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsStationAdmin])
def station_settings(request):
    """Admin endpoint: read/update the station's branding and theme colour."""
    cfg = StationSettings.get()
    if request.method == "PATCH":
        serializer = StationSettingsSerializer(cfg, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        cfg = serializer.save()
        log_audit(
            request.user, "station_settings.update", "station_settings", str(cfg.pk),
            "Updated station branding/appearance", changed=sorted(request.data.keys()),
        )
    return Response(StationSettingsSerializer(cfg).data)

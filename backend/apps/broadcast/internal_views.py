"""Internal endpoints consumed by the Liquidsoap engine.

All routes here require the X-Broadcast-Key header matching BROADCAST_API_KEY
(or the same secret as ?key= on GET, which Liquidsoap's playlist() needs
because it cannot send headers). They are never exposed to anonymous
website visitors.
"""
import logging

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from apps.advertising import services as ad_services

from . import services
from .serializers import BroadcastHistorySerializer
from .models import BroadcastHistory

logger = logging.getLogger("apps")


def _key_ok(request) -> bool:
    # Header is the default. The query parameter exists because Liquidsoap's
    # playlist() cannot attach custom headers to its HTTP fetch — never the
    # only option: POST callers always use the header.
    provided = request.headers.get("X-Broadcast-Key", "") or request.GET.get("key", "")
    return bool(settings.BROADCAST_API_KEY) and provided == settings.BROADCAST_API_KEY


def _reject() -> Response:
    return Response({"detail": "Invalid broadcast key."}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def ingest(request):
    """Liquidsoap reports the item that just started airing."""
    if not _key_ok(request):
        return _reject()
    state = services.ingest_metadata(request.data)
    return Response({"ok": True, "title": state.title})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def heartbeat(request):
    """Liveness ping that doubles as the engine's broadcast-mode poll.

    The response tells the engine whether the station is on air (music
    rotation) or off (loop the off-air audio) and which file to play.
    """
    if not _key_ok(request):
        return _reject()
    services.heartbeat(request.data.get("kind", "music"))
    from apps.common.models import StationSettings

    cfg = StationSettings.get()
    return Response({
        "ok": True,
        "broadcast_enabled": cfg.broadcast_enabled,
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def force_play(request):
    """Admin "Play now": the engine polls this and plays a pending track once.

    Claimed on first successful read (the backend stamps force_started_at),
    so a track airs exactly one time and the rotation resumes after it.
    """
    if not _key_ok(request):
        return _reject()
    return Response(services.build_force_play_payload())


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def listeners(request):
    """Icecast listener count as measured server-side (null clears it)."""
    if not _key_ok(request):
        return _reject()
    count = request.data.get("count")
    services.update_listeners(int(count) if count is not None else None)
    return Response({"ok": True})


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def playlist_m3u(request):
    """M3U playlist of the default rotation for Liquidsoap's playlist().

    HEAD is allowed because Liquidsoap probes with it first; a 405 JSON
    response would make the engine log an unknown-mime warning every reload.
    """
    if not _key_ok(request):
        return _reject()
    body = "".join(f"{line}\n" for line in services.export_playlist_m3u())
    resp = HttpResponse(body, content_type="audio/x-mpegurl")
    resp["Cache-Control"] = "no-cache"
    return resp


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def offair_m3u(request):
    """M3U of the admin's waiting songs — loops while the broadcast is off."""
    if not _key_ok(request):
        return _reject()
    body = "".join(f"{line}\n" for line in services.export_offair_m3u())
    resp = HttpResponse(body, content_type="audio/x-mpegurl")
    resp["Cache-Control"] = "no-cache"
    return resp


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def ad_break_state(request):
    """Whether an ad break should be active right now + the ad queue for it."""
    if not _key_ok(request):
        return _reject()
    return Response(ad_services.build_ad_break_payload())


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def ad_played(request):
    """Engine confirms an advertisement actually aired; records the play log."""
    if not _key_ok(request):
        return _reject()
    return Response(ad_services.record_ad_played(request.data))


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def recent_airings(request):
    """Debug/ops view of what the engine reported most recently."""
    if not _key_ok(request):
        return _reject()
    limit = min(int(request.query_params.get("limit", 10)), 50)
    qs = BroadcastHistory.objects.all()[:limit]
    return Response(BroadcastHistorySerializer(qs, many=True).data)

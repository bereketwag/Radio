"""Public broadcast endpoints: now playing, history, SSE metadata stream."""
import json
import logging
import time

from django.conf import settings
from django.db import close_old_connections
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import AllowAny
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response

from . import services
from .models import BroadcastHistory
from .serializers import BroadcastHistorySerializer

logger = logging.getLogger("apps")


@api_view(["GET"])
@permission_classes([AllowAny])
def now_playing(request):
    """Current broadcast status; the single source of truth for the player."""
    payload = services.build_status_payload()
    if not settings.STREAM_PUBLIC_URL:
        payload["stream_url"] = None
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def history(request):
    """Recently aired items, newest first, from the engine's actual log."""
    limit = min(int(request.query_params.get("limit", 20)), 100)
    qs = BroadcastHistory.objects.all()[: limit + 1]
    state = services.get_state()
    current_id = None
    if state.started_at:
        current_id = (
            BroadcastHistory.objects.filter(started_at=state.started_at, title=state.title)
            .values_list("id", flat=True)
            .first()
        )
    ser = BroadcastHistorySerializer(qs[:limit], many=True, context={"current_history_id": current_id})
    return Response({"count": len(ser.data), "results": ser.data})


@api_view(["GET"])
@permission_classes([AllowAny])
def stream_info(request):
    """What the client needs to attach to the audio element."""
    return Response(
        {
            "stream_url": settings.STREAM_PUBLIC_URL or None,
            "mount": settings.ICECAST_MOUNT,
            "configured": bool(settings.STREAM_PUBLIC_URL),
        }
    )


def _event_stream():
    """SSE generator: pushes state snapshots when they change, heartbeat otherwise."""
    last_signature = None
    close_old_connections()
    deadline = time.time() + 60 * 60  # cap connection lifetime; client reconnects
    try:
        while time.time() < deadline:
            close_old_connections()
            services.check_engine_health()
            payload = services.build_status_payload()
            signature = json.dumps(
                [payload.get("title"), payload.get("started_at"), payload.get("live"), payload.get("listeners")],
                sort_keys=True,
            )
            if signature != last_signature:
                last_signature = signature
                yield f"event: now-playing\ndata: {json.dumps(payload)}\n\n"
            else:
                yield ": keep-alive\n\n"
            time.sleep(3)
    except GeneratorExit:
        pass
    finally:
        close_old_connections()


class EventStreamRenderer(BaseRenderer):
    """Accept `text/event-stream` so DRF's negotiation doesn't 406 SSE.

    EventSource sends `Accept: text/event-stream` exclusively; without a
    matching renderer, DRF answers 406 before the view ever runs.
    """

    media_type = "text/event-stream"
    charset = "utf-8"
    format = "event-stream"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        # The StreamingHttpResponse streams the body itself; DRF only
        # renders its own Response objects, so this is never called.
        return b""


@api_view(["GET"])
@permission_classes([AllowAny])
@renderer_classes([EventStreamRenderer, JSONRenderer])
def now_playing_stream(request):
    """Server-Sent Events stream of now-playing changes."""
    response = StreamingHttpResponse(
        _event_stream(),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-store"
    response["X-Accel-Buffering"] = "no"  # nginx: don't buffer the stream
    return response

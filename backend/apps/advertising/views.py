"""Public advertising endpoints: rotation panel, event tracking, request form."""
import hashlib
import logging


from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.common.models import log_audit

from . import services
from .models import AdRequest, ClickEvent, ImpressionEvent, VisualCampaign
from .serializers import AdRequestSerializer, VisualCampaignPublicSerializer

logger = logging.getLogger("apps")


def _client_fingerprint(request) -> tuple[str, str]:
    """(session_key, ip_hash) — hashed, no raw IPs stored."""
    session_key = request.session.session_key or ""
    if not session_key:
        request.session.save()
        session_key = request.session.session_key or ""
    raw = request.META.get("REMOTE_ADDR", "").encode()
    salt = settings.SECRET_KEY.encode()
    return session_key, hashlib.sha256(salt + raw).hexdigest()[:32]


@api_view(["GET"])
@permission_classes([AllowAny])
def banner_rotation(request):
    """Eligible banners for the sponsor panel, in rotation order.

    Never returns unapproved, unpaid, or expired campaigns. Falls back to an
    empty list — the frontend shows the 'Advertise With Us' placeholder.
    """
    placement = request.query_params.get("placement")
    campaigns = services.eligible_visual_campaigns(placement=placement)
    ordered = services.rotation_order(campaigns)
    ser = VisualCampaignPublicSerializer(ordered, many=True)
    return Response({"results": ser.data, "count": len(ser.data)})


class _AdEventThrottle(SimpleRateThrottle):
    """Anonymous rate limit for impression/click pings (per IP)."""

    rate = "120/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": "ad_event", "ident": self.get_ident(request)}


class _AdRequestThrottle(SimpleRateThrottle):
    """Anonymous rate limit for the public ad-request form (per IP)."""

    rate = "5/hour"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": "ad_request", "ident": self.get_ident(request)}


@api_view(["POST"])
@permission_classes([AllowAny])
def track_impression(request, campaign_id):
    """Record a measured impression (one per session per campaign per 5 min)."""
    if not _AdEventThrottle().allow_request(request, None):
        return Response({"ok": True})  # silently swallow floods
    campaign = VisualCampaign.objects.filter(id=campaign_id).first()
    if campaign is None or not campaign.is_eligible():
        return Response({"detail": "Campaign not available."}, status=status.HTTP_404_NOT_FOUND)
    session_key, ip_hash = _client_fingerprint(request)
    window_start = timezone.now() - timezone.timedelta(minutes=5)
    recent = ImpressionEvent.objects.filter(
        campaign=campaign, session_key=session_key, created_at__gte=window_start
    ).exists()
    if not recent:
        with transaction.atomic():
            ImpressionEvent.objects.create(campaign=campaign, session_key=session_key, ip_hash=ip_hash)
            VisualCampaign.objects.filter(pk=campaign.pk).update(impressions=F("impressions") + 1)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([AllowAny])
def track_click(request, campaign_id):
    """Record a measured click and return the destination URL."""
    campaign = VisualCampaign.objects.filter(id=campaign_id).first()
    if campaign is None or not campaign.is_eligible():
        return Response({"detail": "Campaign not available."}, status=status.HTTP_404_NOT_FOUND)
    session_key, ip_hash = _client_fingerprint(request)
    with transaction.atomic():
        ClickEvent.objects.create(campaign=campaign, session_key=session_key, ip_hash=ip_hash)
        VisualCampaign.objects.filter(pk=campaign.pk).update(clicks=F("clicks") + 1)
    return Response({"url": campaign.destination_url})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_ad_requests(request):
    """The signed-in user's own submissions (matched by their email)."""
    qs = AdRequest.objects.filter(email=request.user.email)
    ser = AdRequestSerializer(qs, many=True)
    return Response({"results": ser.data, "count": len(ser.data)})


@api_view(["POST"])
@permission_classes([AllowAny])
def submit_ad_request(request):
    """Public 'Request an Advertisement' form.

    The submission is stored as PENDING — it is never presented as approved
    or paid. Rate limited per-IP via the `ad_request` throttle scope.
    """
    if not _AdRequestThrottle().allow_request(request, None):
        return Response(
            {"detail": "Too many submissions. Please try again later."}, status=status.HTTP_429_TOO_MANY_REQUESTS
        )
    ser = AdRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ad_request = ser.save()
    log_audit(
        None, "ad_request.create", "ad_request", str(ad_request.id),
        f"New advertisement request from {ad_request.business_name}",
    )
    return Response(
        {
            "id": str(ad_request.id),
            "status": ad_request.status,
            "detail": "Thank you! Your request has been received and is pending review. "
            "Our advertising team will contact you by email. Nothing is confirmed until you hear from us.",
        },
        status=status.HTTP_201_CREATED,
    )


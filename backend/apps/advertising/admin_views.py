"""Administrative API for the station's ad operations and music library.

All routes require authentication and the appropriate station role:
- station admins / super admins: everything
- advertising managers: campaigns, requests, advertisers
- advertisers: read-only view of their own data (via queryset scoping)
"""
import logging

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import Role, User
from apps.accounts.serializers import AdminCreateUserSerializer, RoleUpdateSerializer, UserSerializer
from apps.broadcast.models import BroadcastHistory, OffAirTrack, Playlist, PlaylistEntry, Track
from apps.broadcast.serializers import (
    BroadcastHistorySerializer,
    OffAirTrackSerializer,
    PlaylistSerializer,
    TrackSerializer,
)
from apps.common.models import AuditLog, HealthEvent, log_audit
from apps.common.permissions import (
    IsAdvertisingTeam,
    IsStationAdmin,
    IsSuperAdmin,
    user_has_role,
)

from . import services
from .models import (
    AdBreakLog,
    AdRequest,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    VisualCampaign,
)
from .serializers import (
    AdBreakLogSerializer,
    AdRequestSerializer,
    AdScheduleSerializer,
    AdvertiserSerializer,
    AudioAdvertSerializer,
    AudioCampaignSerializer,
    VisualCampaignSerializer,
)

logger = logging.getLogger("apps")


def _audit(request, action_name: str, obj, summary: str = "", **extra):
    log_audit(
        request.user, action_name, obj.__class__.__name__.lower(),
        str(obj.id), summary or str(obj), **extra,
    )


# ---------------------------------------------------------------------------
# Advertiser requests
# ---------------------------------------------------------------------------
class AdRequestViewSet(ModelViewSet):
    serializer_class = AdRequestSerializer
    pagination_class = None
    permission_classes = [IsAdvertisingTeam]

    def get_queryset(self):
        qs = AdRequest.objects.all()
        s = self.request.query_params.get("status")
        if s:
            qs = qs.filter(status=s)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "ad_request.create", obj, f"Request from {obj.business_name}")

    def perform_destroy(self, instance):
        _audit(self.request, "ad_request.delete", instance, f"Deleted request from {instance.business_name}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """Approve or reject a request; optionally link it to a created campaign."""
        ad_request = self.get_object()
        decision = request.data.get("decision")
        note = request.data.get("note", "")
        if decision not in ("approved", "rejected"):
            return Response({"detail": "decision must be 'approved' or 'rejected'."}, status=400)
        ad_request.status = decision
        ad_request.status_note = note
        ad_request.handled_by = request.user
        ad_request.handled_at = timezone.now()
        ad_request.save()
        _audit(request, f"ad_request.{decision}", ad_request, note)
        return Response(AdRequestSerializer(ad_request).data)


# ---------------------------------------------------------------------------
# Advertisers
# ---------------------------------------------------------------------------
class AdvertiserViewSet(ModelViewSet):
    serializer_class = AdvertiserSerializer
    permission_classes = [IsAdvertisingTeam]
    pagination_class = None

    def get_queryset(self):
        qs = Advertiser.objects.all()
        if user_has_role(self.request.user, Role.ADVERTISER) and not user_has_role(
            self.request.user, Role.SUPER_ADMIN, Role.STATION_ADMIN, Role.AD_MANAGER
        ):
            qs = qs.filter(owner=self.request.user)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "advertiser.create", obj, f"Advertiser {obj.name}")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "advertiser.update", obj, f"Updated {obj.name}")

    def perform_destroy(self, instance):
        _audit(self.request, "advertiser.delete", instance, f"Deleted {instance.name}")
        instance.delete()


# ---------------------------------------------------------------------------
# Visual campaigns
# ---------------------------------------------------------------------------
class VisualCampaignViewSet(ModelViewSet):
    serializer_class = VisualCampaignSerializer
    permission_classes = [IsAdvertisingTeam]

    def get_queryset(self):
        qs = VisualCampaign.objects.select_related("advertiser", "request")
        s = self.request.query_params.get("status")
        if s:
            qs = qs.filter(status=s)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "visual_campaign.create", obj, f"Banner campaign {obj.name}")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "visual_campaign.update", obj, f"Updated {obj.name}")

    def perform_destroy(self, instance):
        _audit(self.request, "visual_campaign.delete", instance, f"Deleted {instance.name}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        """Transition a campaign (approve, activate, pause, reject)."""
        campaign = self.get_object()
        new_status = request.data.get("status")
        if new_status not in CampaignStatus.values:
            return Response({"detail": "Invalid status."}, status=400)
        campaign.status = new_status
        campaign.save(update_fields=["status"])
        _audit(request, f"visual_campaign.{new_status}", campaign, f"{campaign.name} -> {new_status}")
        return Response(VisualCampaignSerializer(campaign).data)

    @action(detail=True, methods=["post"])
    def set_payment(self, request, pk=None):
        campaign = self.get_object()
        ps = request.data.get("payment_status")
        if ps not in ("unpaid", "pending", "paid"):
            return Response({"detail": "Invalid payment_status."}, status=400)
        campaign.payment_status = ps
        campaign.save(update_fields=["payment_status"])
        _audit(request, "visual_campaign.payment", campaign, f"{campaign.name} payment -> {ps}")
        return Response(VisualCampaignSerializer(campaign).data)


# ---------------------------------------------------------------------------
# Audio campaigns, adverts, schedules
# ---------------------------------------------------------------------------
class AudioAdvertViewSet(ModelViewSet):
    serializer_class = AudioAdvertSerializer
    permission_classes = [IsAdvertisingTeam]
    pagination_class = None

    def get_queryset(self):
        return AudioAdvert.objects.all()

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "audio_advert.create", obj, f"Advert {obj.name}")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "audio_advert.update", obj, f"Updated {obj.name}")

    def perform_destroy(self, instance):
        _audit(self.request, "audio_advert.delete", instance, f"Deleted {instance.name}")
        instance.delete()


class AudioCampaignViewSet(ModelViewSet):
    serializer_class = AudioCampaignSerializer
    permission_classes = [IsAdvertisingTeam]

    def get_queryset(self):
        qs = AudioCampaign.objects.select_related("advertiser").prefetch_related("adverts", "schedules")
        s = self.request.query_params.get("status")
        if s:
            qs = qs.filter(status=s)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "audio_campaign.create", obj, f"Audio campaign {obj.name}")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "audio_campaign.update", obj, f"Updated {obj.name}")

    def perform_destroy(self, instance):
        _audit(self.request, "audio_campaign.delete", instance, f"Deleted {instance.name}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        campaign = self.get_object()
        new_status = request.data.get("status")
        if new_status not in CampaignStatus.values:
            return Response({"detail": "Invalid status."}, status=400)
        campaign.status = new_status
        campaign.save(update_fields=["status"])
        _audit(request, f"audio_campaign.{new_status}", campaign, f"{campaign.name} -> {new_status}")
        return Response(AudioCampaignSerializer(campaign).data)

    @action(detail=True, methods=["post"])
    def set_payment(self, request, pk=None):
        campaign = self.get_object()
        ps = request.data.get("payment_status")
        if ps not in ("unpaid", "pending", "paid"):
            return Response({"detail": "Invalid payment_status."}, status=400)
        campaign.payment_status = ps
        campaign.save(update_fields=["payment_status"])
        _audit(request, "audio_campaign.payment", campaign, f"{campaign.name} payment -> {ps}")
        return Response(AudioCampaignSerializer(campaign).data)

    @action(detail=True, methods=["get", "post"])
    def schedules(self, request, pk=None):
        """List or create schedules for this campaign (with conflict check)."""
        campaign = self.get_object()
        if request.method == "GET":
            ser = AdScheduleSerializer(campaign.schedules.all(), many=True)
            return Response(ser.data)
        ser = AdScheduleSerializer(data={**request.data, "campaign": str(campaign.id)})
        ser.is_valid(raise_exception=True)
        schedule = ser.save()
        conflicts = services.find_schedule_conflicts(campaign, schedule)
        _audit(request, "ad_schedule.create", schedule, f"Schedule for {campaign.name}", conflicts=len(conflicts))
        return Response(
            {"schedule": AdScheduleSerializer(schedule).data, "conflicts": conflicts},
            status=status.HTTP_201_CREATED,
        )


class AdScheduleViewSet(ModelViewSet):
    serializer_class = AdScheduleSerializer
    permission_classes = [IsAdvertisingTeam]
    pagination_class = None

    def get_queryset(self):
        return AdSchedule.objects.select_related("campaign", "campaign__advertiser")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "ad_schedule.update", obj, f"Updated schedule {obj.id}")

    def perform_destroy(self, instance):
        _audit(self.request, "ad_schedule.delete", instance, f"Deleted schedule {instance.id}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def check_conflicts(self, request, pk=None):
        schedule = self.get_object()
        return Response({"conflicts": services.find_schedule_conflicts(schedule.campaign, schedule)})

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        """Immediate kill-switch for a schedule (e.g. advertiser calls it off)."""
        schedule = self.get_object()
        schedule.enabled = False
        schedule.save(update_fields=["enabled"])
        _audit(request, "ad_schedule.disable", schedule, f"Disabled schedule {schedule.id}")
        return Response({"detail": "Schedule disabled."})


class AdBreakLogViewSet(ModelViewSet):
    """Read-only view of actual broadcast logs (scheduled vs played)."""

    serializer_class = AdBreakLogSerializer
    permission_classes = [IsAdvertisingTeam]
    pagination_class = None
    http_method_names = ["get"]

    def get_queryset(self):
        qs = AdBreakLog.objects.select_related("campaign").prefetch_related("adverts_played")
        campaign_id = self.request.query_params.get("campaign")
        if campaign_id:
            qs = qs.filter(campaign_id=campaign_id)
        return qs


# ---------------------------------------------------------------------------
# Music library + playlists (station admins)
# ---------------------------------------------------------------------------
class TrackViewSet(ModelViewSet):
    serializer_class = TrackSerializer
    permission_classes = [IsStationAdmin]

    def get_queryset(self):
        qs = Track.objects.all()
        q = self.request.query_params.get("search")
        if q:
            from django.db.models import Q

            qs = qs.filter(Q(title__icontains=q) | Q(artist__icontains=q) | Q(album__icontains=q))
        enabled = self.request.query_params.get("enabled")
        if enabled is not None:
            qs = qs.filter(enabled=enabled.lower() == "true")
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, "track.create", obj, f"Track {obj.title} — {obj.artist}")

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, "track.update", obj, f"Updated {obj.title}")

    def perform_destroy(self, instance):
        _audit(self.request, "track.delete", instance, f"Deleted {instance.title}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def toggle_enabled(self, request, pk=None):
        track = self.get_object()
        track.enabled = not track.enabled
        track.save(update_fields=["enabled"])
        _audit(request, "track.toggle_enabled", track, f"{track.title} enabled={track.enabled}")
        return Response(TrackSerializer(track).data)

    @action(detail=True, methods=["post"], url_path="play_now")
    def play_now(self, request, pk=None):
        """Force this track onto the stream immediately (interrupts the current item).

        Queued in BroadcastState; the engine claims it within ~5s via the
        force-play poll, plays it once, then the rotation resumes.
        """
        from apps.broadcast.services import request_force_play

        track = self.get_object()
        try:
            state = request_force_play(track)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        _audit(request, "track.play_now", track, f"Force play {track.title} — {track.artist}")
        from apps.common.models import StationSettings

        broadcast_on = StationSettings.get().broadcast_enabled
        return Response(
            {
                "ok": True,
                "title": track.title,
                "artist": track.artist,
                "broadcast_enabled": broadcast_on,
                "detail": (
                    "Queued to play now — it starts within a few seconds."
                    if broadcast_on
                    else "Queued. The broadcast is off; it will play when you turn the broadcast on."
                ),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"])
    def airings(self, request, pk=None):
        track = self.get_object()
        qs = BroadcastHistory.objects.filter(track=track)[:50]
        return Response(BroadcastHistorySerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Library totals: song count and summed runtime (measured from files)."""
        return Response(_music_totals())


class OffAirTrackViewSet(ModelViewSet):
    """Waiting songs for the off-air state — a mini library that only airs
    while the broadcast is off (Settings → Off-air songs)."""

    serializer_class = OffAirTrackSerializer
    permission_classes = [IsStationAdmin]
    pagination_class = None
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return OffAirTrack.objects.all()

    def perform_create(self, serializer):
        last = OffAirTrack.objects.order_by("-position").values_list("position", flat=True).first() or 0
        obj = serializer.save(position=last + 1)
        _audit(self.request, "offair.create", obj, f"Off-air upload {obj}")

    def perform_destroy(self, instance):
        _audit(self.request, "offair.delete", instance, f"Removed off-air track {instance}")
        instance.delete()


class PlaylistViewSet(ModelViewSet):
    serializer_class = PlaylistSerializer
    permission_classes = [IsStationAdmin]
    pagination_class = None

    def get_queryset(self):
        return Playlist.objects.prefetch_related("entries__track").order_by("name")

    @staticmethod
    def _resolve_collision(obj: Playlist, action_data: dict, create: bool) -> None:
        """Default and fallback are mutually exclusive roles.

        On create, a form that checks both keeps default (primary role). On
        update, the last explicit action wins — clicking "Make fallback" on
        the default playlist must demote it from default, not silently revert.
        """
        if not (obj.is_default and obj.is_fallback):
            return
        if create or action_data.get("is_default"):
            obj.is_fallback = False
        else:
            obj.is_default = False
        obj.save(update_fields=["is_default", "is_fallback"])

    @staticmethod
    def _uniquify(obj: Playlist) -> None:
        """Exactly one default and one fallback across all playlists."""
        if obj.is_default:
            Playlist.objects.filter(is_default=True).exclude(pk=obj.pk).update(is_default=False)
        if obj.is_fallback:
            Playlist.objects.filter(is_fallback=True).exclude(pk=obj.pk).update(is_fallback=False)

    def perform_create(self, serializer):
        obj = serializer.save()
        self._resolve_collision(obj, {}, create=True)
        self._uniquify(obj)
        _audit(self.request, "playlist.create", obj, f"Playlist {obj.name}")

    def perform_update(self, serializer):
        obj = serializer.save()
        self._resolve_collision(obj, serializer.validated_data, create=False)
        self._uniquify(obj)
        _audit(self.request, "playlist.update", obj, f"Updated playlist {obj.name}")

    def perform_destroy(self, instance):
        _audit(self.request, "playlist.delete", instance, f"Deleted playlist {instance.name}")
        instance.delete()

    @action(detail=True, methods=["post"])
    def add_track(self, request, pk=None):
        playlist = self.get_object()
        track_id = request.data.get("track_id")
        track = Track.objects.filter(id=track_id).first()
        if track is None:
            return Response({"detail": "Track not found."}, status=404)
        last = playlist.entries.order_by("-position").first()
        position = (last.position + 1) if last else 0
        entry = PlaylistEntry.objects.create(playlist=playlist, track=track, position=position)
        _audit(request, "playlist.add_track", playlist, f"Added {track.title} to {playlist.name}")
        return Response({"id": str(entry.id), "position": entry.position}, status=201)

    @action(detail=True, methods=["post"])
    def remove_track(self, request, pk=None):
        playlist = self.get_object()
        entry = playlist.entries.filter(id=request.data.get("entry_id")).first()
        if entry is None:
            return Response({"detail": "Entry not found."}, status=404)
        _audit(request, "playlist.remove_track", playlist, f"Removed {entry.track.title}")
        entry.delete()
        return Response({"detail": "Removed."})

    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """Accept an ordered list of entry ids and rewrite positions."""
        playlist = self.get_object()
        order = request.data.get("order", [])
        with transaction.atomic():
            entries = {str(e.id): e for e in playlist.entries.all()}
            pos = 0
            for entry_id in order:
                entry = entries.get(str(entry_id))
                if entry:
                    entry.position = pos
                    entry.save(update_fields=["position"])
                    pos += 1
        _audit(request, "playlist.reorder", playlist, f"Reordered {playlist.name}")
        return Response(PlaylistSerializer(playlist).data)

    @action(detail=True, methods=["post"])
    def play_now(self, request, pk=None):
        """Put this playlist on air now (e.g. a Christmas playlist).

        Overrides the normal rotation until stop is pressed; the engine
        picks the change up on its next m3u reload (~15s).
        """
        from apps.broadcast.services import request_playlist_override

        playlist = self.get_object()
        try:
            request_playlist_override(playlist)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        _audit(request, "playlist.play_now", playlist, f"Playlist on air: {playlist.name}")
        return Response(
            {
                "detail": f"“{playlist.name}” is on air now. The stream switches within ~15s; press Stop to resume the normal rotation.",
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        """Take this playlist off air and resume the normal rotation."""
        from apps.broadcast.services import get_state, stop_playlist_override

        playlist = self.get_object()
        if get_state().override_playlist_id != playlist.id:
            return Response({"detail": "This playlist is not on air."}, status=status.HTTP_400_BAD_REQUEST)
        stop_playlist_override()
        _audit(request, "playlist.stop", playlist, f"Playlist off air: {playlist.name}")
        return Response({"detail": "Normal rotation resumes within ~15s."})


# ---------------------------------------------------------------------------
# Users, logs, overview
# ---------------------------------------------------------------------------
class AdminUserViewSet(ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsSuperAdmin]
    pagination_class = None
    http_method_names = ["get", "post", "head", "options"]
    queryset = User.objects.all().order_by("email")

    def get_serializer_class(self):
        if self.action == "change_role":
            return RoleUpdateSerializer
        if self.action == "create":
            return AdminCreateUserSerializer
        return UserSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        role = self.request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        q = self.request.query_params.get("search")
        if q:
            qs = qs.filter(Q(email__icontains=q) | Q(display_name__icontains=q))
        return qs

    def create(self, request, *args, **kwargs):
        ser = AdminCreateUserSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = ser.save()
        log_audit(request.user, "user.create", "user", str(user.id), f"Created {user.email} ({user.role})")
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="change-role")
    def change_role(self, request, pk=None):
        user = self.get_object()
        if user.id == request.user.id:
            return Response({"detail": "You cannot change your own role."}, status=status.HTTP_400_BAD_REQUEST)
        ser = RoleUpdateSerializer(user, data=request.data)
        ser.is_valid(raise_exception=True)
        old = user.role
        ser.save()
        user.is_staff = user.role in {Role.SUPER_ADMIN, Role.STATION_ADMIN, Role.AD_MANAGER}
        user.is_superuser = user.role == Role.SUPER_ADMIN
        user.save(update_fields=["is_staff", "is_superuser"])
        log_audit(request.user, "user.change_role", "user", str(user.id), f"{user.email}: {old} -> {user.role}")
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """Super admin: reset a forgotten password to a random temporary one.

        No email involved — the admin reads the temporary password off the
        screen and gives it to the user once (it is never shown again).
        Existing sessions for that user are invalidated.
        """
        import secrets

        from rest_framework.authtoken.models import Token

        user = self.get_object()
        temp = secrets.token_urlsafe(12)
        user.set_password(temp)
        user.save(update_fields=["password"])
        Token.objects.filter(user=user).delete()
        log_audit(request.user, "user.reset_password", "user", str(user.id), f"Reset password for {user.email}")
        return Response(
            {
                "detail": "Password reset. Share this temporary password with the user — it is shown only once. They should change it after signing in.",
                "temporary_password": temp,
            }
        )


@api_view(["GET"])
@permission_classes([IsAdvertisingTeam])
def audit_logs(request):
    limit = min(int(request.query_params.get("limit", 50)), 200)
    qs = AuditLog.objects.all()[:limit]
    from apps.common.serializers import AuditLogSerializer

    return Response({"results": AuditLogSerializer(qs, many=True).data})


@api_view(["GET"])
@permission_classes([IsAdvertisingTeam])
def health_events(request):
    limit = min(int(request.query_params.get("limit", 50)), 200)
    qs = HealthEvent.objects.all()[:limit]
    from apps.common.serializers import HealthEventSerializer

    return Response({"results": HealthEventSerializer(qs, many=True).data})


@api_view(["GET"])
@permission_classes([IsAdvertisingTeam])
def overview(request):
    """Dashboard overview — every number is database- or engine-derived."""
    from apps.broadcast.services import build_status_payload, playlist_override_status

    from .models import ClickEvent, ImpressionEvent

    now = timezone.now()
    status_payload = build_status_payload()

    totals = VisualCampaign.objects.aggregate(impressions=Sum("impressions"), clicks=Sum("clicks"))
    week_ago = now - timezone.timedelta(days=7)
    impressions_7d = ImpressionEvent.objects.filter(created_at__gte=week_ago).count()
    clicks_7d = ClickEvent.objects.filter(created_at__gte=week_ago).count()
    upcoming = AdBreakLog.objects.filter(scheduled_for__gte=now, result=AdBreakLog.Result.MISSED)[:10]

    return Response(
        {
            "broadcast": status_payload,
            "playlist_override": playlist_override_status(),
            "active_visual_campaigns": services.eligible_visual_campaigns().__len__(),
            "active_audio_campaigns": AudioCampaign.objects.filter(
                status__in=[CampaignStatus.APPROVED, CampaignStatus.ACTIVE]
            ).count(),
            "pending_ad_requests": AdRequest.objects.filter(status=AdRequest.Status.PENDING).count(),
            "total_impressions": totals["impressions"] or 0,
            "total_clicks": totals["clicks"] or 0,
            "ad_performance_7d": {"impressions": impressions_7d, "clicks": clicks_7d},
            "upcoming_breaks": AdBreakLogSerializer(upcoming, many=True).data,
            "recent_errors": [
                {"code": e.code, "message": e.message, "severity": e.severity, "created_at": e.created_at.isoformat()}
                for e in HealthEvent.objects.filter(severity="error")[:10]
            ],
            "scheduled_vs_played": services.scheduled_vs_played(),
            "music": _music_totals(),
        }
    )


def _music_totals() -> dict:
    """Song count + summed runtime for the dashboard (database-derived)."""
    totals = Track.objects.aggregate(
        total=Count("id"),
        enabled=Count("id", filter=Q(enabled=True)),
        seconds=Sum("duration_seconds"),
    )
    seconds = totals["seconds"] or 0
    return {
        "total_songs": totals["total"],
        "enabled_songs": totals["enabled"],
        "total_seconds": seconds,
        "total_minutes": round(seconds / 60, 1),
    }


@api_view(["POST"])
@permission_classes([IsAdvertisingTeam])
def run_ad_break_check(request):
    """Admin trigger for the missed-break sweep (also available via cron)."""
    marked = services.close_missed_breaks()
    return Response({"marked_missed": marked})

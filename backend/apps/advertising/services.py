"""Advertising service layer — the business rules.

Everything the engine and the website serve flows through here:
- visual campaign eligibility (approved + paid + inside window, never expired)
- audio ad break construction (schedules, recurrence, overlap avoidance)
- schedule conflict detection
- recording actual plays and missed breaks
"""
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils import timezone

from apps.common.models import HealthEvent, record_health_event
from apps.common.utils import public_media_url

from .models import (
    AdBreakLog,
    AdSchedule,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    ImpressionEvent,
    PaymentStatus,
    VisualCampaign,
)

logger = logging.getLogger("apps")

# A break opens this many seconds after its scheduled instant to let the
# engine finish the current track (documented "safe point" policy).
BREAK_GRACE_SECONDS = 20
# A break stays open for at most this long after the scheduled instant.
BREAK_WINDOW_SECONDS = 300


def eligible_visual_campaigns(placement: str | None = None, at=None) -> list[VisualCampaign]:
    """Approved, non-expired visual campaigns eligible for rotation right now."""
    at = at or timezone.now()
    window = (
        models.Q(starts_at__lte=at, ends_at__gte=at)
        | models.Q(starts_at__isnull=True, ends_at__gte=at)
        | models.Q(starts_at__lte=at, ends_at__isnull=True)
        | models.Q(starts_at__isnull=True, ends_at__isnull=True)
    )
    qs = (
        VisualCampaign.objects.filter(status__in=[CampaignStatus.APPROVED, CampaignStatus.ACTIVE])
        .exclude(payment_status=PaymentStatus.UNPAID)
        .filter(window)
        # A campaign with no uploaded creative is a draft shell (e.g. one built
        # from an approved request). It must never reach the public rotation —
        # is_eligible() already refuses it, and this mirrors that in SQL.
        .filter(banner_image__isnull=False)
        .exclude(banner_image="")
    )
    if placement:
        qs = qs.filter(placement=placement)
    return list(qs.select_related("advertiser"))


def rotation_order(campaigns: list[VisualCampaign]) -> list[VisualCampaign]:
    """Order by priority (desc), rotating deterministically within a time bucket.

    Higher priority campaigns lead each bucket; ties rotate by minute so no
    campaign is starved. Rotation state is not stored — this is stateless and
    safe to compute per request.
    """
    bucket = int(timezone.now().timestamp() // 15)  # 15s rotation tick
    scored = []
    for c in campaigns:
        tiebreak = (bucket + hash(str(c.id))) % max(len(campaigns), 1)
        scored.append((-(c.priority or 0), tiebreak, c))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [c for _, _, c in scored]


# ---------------------------------------------------------------------------
# Audio ad breaks
# ---------------------------------------------------------------------------

def _station_tz() -> ZoneInfo:
    return ZoneInfo(settings.STATION_TIMEZONE)


def schedule_window_bounds(schedule: AdSchedule, at=None):
    """(window_start, window_end) UTC instants of the break containing `at`, else None."""
    at = at or timezone.now()
    for start, end in iter_occurrences(schedule, at - timedelta(days=1), at + timedelta(days=1)):
        if start <= at <= end:
            return (start, end)
    return None


def iter_occurrences(schedule: AdSchedule, window_start, window_end):
    """Yield (start, end) UTC break windows for this schedule within [window_start, window_end].

    ONCE schedules yield their single instant (if it falls in the range).
    DAILY/WEEKLY yield each occurrence in station-local time, converted to UTC.
    """
    tz = _station_tz()
    span = timedelta(seconds=schedule.max_break_seconds + BREAK_WINDOW_SECONDS)

    if schedule.recurrence == AdSchedule.Recurrence.ONCE:
        start = schedule.starts_at
        if start and window_start <= start <= window_end:
            yield (start, start + span)
        return

    if schedule.local_time is None:
        return

    first_day = window_start.astimezone(tz).date()
    last_day = window_end.astimezone(tz).date()
    day = first_day
    while day <= last_day:
        applies = schedule.recurrence == AdSchedule.Recurrence.DAILY or (
            schedule.recurrence == AdSchedule.Recurrence.WEEKLY and schedule.weekday == day.weekday()
        )
        if applies:
            start = datetime.combine(day, schedule.local_time, tzinfo=tz)
            if window_start <= start <= window_end:
                yield (start, start + span)
        day += timedelta(days=1)


def active_breaks(at=None) -> list[tuple[AdSchedule, datetime, datetime]]:
    """All enabled schedules whose break window contains `at` (campaign eligible)."""
    at = at or timezone.now()
    results = []
    for schedule in (
        AdSchedule.objects.filter(enabled=True).select_related("campaign", "campaign__advertiser").prefetch_related("campaign__adverts")
    ):
        campaign = schedule.campaign
        if not campaign.is_eligible(at):
            continue
        bounds = schedule_window_bounds(schedule, at)
        if bounds:
            results.append((schedule, bounds[0], bounds[1]))
    return results


def build_ad_break_payload(at=None) -> dict:
    """Payload for the engine: is a break open, and which adverts to play.

    Selects approved+active adverts from eligible campaigns ordered by
    campaign priority then advert order, capped by the schedule's
    max_break_seconds.

    An unconfirmed break stays `active` for its ENTIRE window: the engine
    polls every 15s and must keep receiving the queue until the next track
    boundary arrives (documented safe-point policy). A window is only closed
    once the engine confirms a play (or the window expires untouched).
    """
    at = at or timezone.now()
    breaks = active_breaks(at)
    if not breaks:
        # schedule_id is always present (empty when no break) so the engine's
        # typed JSON parse succeeds on every poll, not only during breaks.
        return {"active": False, "adverts": [], "max_break_seconds": 0, "schedule_id": ""}

    # Pick the highest-priority campaign's break; avoid overlapping breaks.
    schedule, window_start, window_end = sorted(breaks, key=lambda b: (-b[0].campaign.priority, b[0].starts_at))[0]

    # Already *confirmed* for this window? Never serve a finished break twice.
    # Unconfirmed (still-open) logs intentionally do NOT close the window —
    # gating on the just-created open log made `active` true for only a single
    # 15s poll per window, which the engine almost never caught at a track
    # boundary (0 of 7 breaks aired before this was fixed).
    confirmed = (
        AdBreakLog.objects.filter(schedule=schedule, scheduled_for__gte=window_start - timedelta(minutes=5))
        .exclude(result=AdBreakLog.Result.MISSED)
        .exists()
    )
    if confirmed:
        return {"active": False, "adverts": [], "max_break_seconds": 0, "schedule_id": "", "detail": "break already served"}

    # Open the break exactly once per window, however many polls arrive.
    AdBreakLog.objects.get_or_create(
        schedule=schedule,
        scheduled_for=window_start,
        defaults={
            "campaign": schedule.campaign,
            "result": AdBreakLog.Result.MISSED,  # upgraded when the engine reports plays
            "detail": "opened; awaiting engine confirmation",
        },
    )
    if schedule.last_run_at != window_start:
        schedule.last_run_at = window_start
        schedule.save(update_fields=["last_run_at"])

    budget = schedule.max_break_seconds
    spots = list(schedule.campaign.adverts.filter(approved=True, active=True).order_by("name"))
    # Rotate which spot leads, keyed on the window start so every 15s poll in
    # the same window gets the identical queue (the engine must see a stable
    # list) while different windows lead with a different spot — otherwise the
    # alphabetically-first advert would air in every break and starve the rest.
    if spots:
        rotate_by = int(window_start.timestamp()) % len(spots)
        spots = spots[rotate_by:] + spots[:rotate_by]

    adverts: list[AudioAdvert] = []
    used = 0
    for advert in spots:
        if used + advert.duration_seconds > budget and adverts:
            break
        if advert.duration_seconds > budget:
            continue
        adverts.append(advert)
        used += advert.duration_seconds

    return {
        "active": True,
        "schedule_id": str(schedule.id),
        "campaign_id": str(schedule.campaign.id),
        "adverts": [
            {
                "id": str(a.id),
                "uri": public_media_url(a.audio_file.url) if a.audio_file else "",
                "duration": a.duration_seconds,
                "name": a.name,
            }
            for a in adverts
            if a.audio_file
        ],
        "max_break_seconds": budget,
        "window_ends_at": window_end.isoformat(),
    }


def record_ad_played(payload: dict) -> dict:
    """Engine confirms an advert aired. Updates the open break log for its campaign.

    Accepts the advert id (preferred, carried through request metadata) or
    falls back to matching the played filename against the advert library.
    """
    advert_id = payload.get("advert_id") or payload.get("id")
    played_at = payload.get("played_at")
    duration = max(0, int(payload.get("duration") or 0))

    advert = AudioAdvert.objects.filter(id=advert_id).first() if advert_id else None
    if advert is None:
        # Fallback: match by filename (the engine reports the request filename).
        filename = str(payload.get("filename") or "")
        if filename:
            basename = filename.rstrip("/").split("/")[-1].split("?")[0]
            if basename:
                advert = AudioAdvert.objects.filter(audio_file__endswith=basename).first()
    if advert is None:
        return {"ok": False, "detail": "unknown advert"}

    moment = timezone.now()
    horizon = moment - timedelta(seconds=BREAK_WINDOW_SECONDS + BREAK_GRACE_SECONDS)

    def _accumulate(existing: AdBreakLog) -> dict:
        """A duplicate metadata event for a break we already recorded."""
        existing.seconds_played += duration
        existing.finished_at = moment
        existing.save(update_fields=["seconds_played", "finished_at"])
        return {"ok": True, "break_log_id": str(existing.id), "duplicate": True}

    log = None
    schedule_id = payload.get("schedule_id")
    if schedule_id:
        # The engine reports which break this play belongs to — exact even
        # when two windows overlap (a campaign-wide 'latest missed' lookup
        # would confirm the wrong row).
        log = AdBreakLog.objects.filter(schedule_id=schedule_id, result=AdBreakLog.Result.MISSED).first()
        if log is None:
            same_break = AdBreakLog.objects.filter(schedule_id=schedule_id).first()
            if (
                same_break is not None
                and same_break.result in (AdBreakLog.Result.PLAYED, AdBreakLog.Result.PARTIAL)
                and same_break.scheduled_for >= horizon
            ):
                return _accumulate(same_break)
    if log is None:
        # Only confirm against a break from a *live* window: a late duplicate
        # must never resurrect an expired break (an old test session flipped a
        # 45-minute-old missed row to "played" this way).
        log = (
            AdBreakLog.objects.filter(
                campaign__adverts=advert,
                result=AdBreakLog.Result.MISSED,
                scheduled_for__gte=horizon,
            )
            .order_by("-scheduled_for")
            .first()
        )
    if log is None:
        already = (
            AdBreakLog.objects.filter(
                campaign__adverts=advert,
                result__in=[AdBreakLog.Result.PLAYED, AdBreakLog.Result.PARTIAL],
                scheduled_for__gte=horizon,
            )
            .order_by("-scheduled_for")
            .first()
        )
        if already is not None:
            return _accumulate(already)
    if log is None:
        campaign = advert.campaigns.first()
        if campaign is None:
            return {"ok": False, "detail": "advert not linked to a campaign"}
        log = AdBreakLog.objects.create(campaign=campaign, scheduled_for=moment)
    log.adverts_played.add(advert)
    log.seconds_played += duration
    log.result = AdBreakLog.Result.PLAYED
    if log.started_at is None:
        log.started_at = moment
    log.finished_at = moment
    log.detail = payload.get("filename", "") or log.detail
    log.save()
    return {"ok": True, "break_log_id": str(log.id)}


def close_missed_breaks(at=None) -> int:
    """Mark open break logs whose windows expired without engine confirmation.

    Returns the number of breaks marked missed. Run periodically by the
    management command `check_ad_breaks`.
    """
    at = at or timezone.now()
    cutoff = at - timedelta(seconds=BREAK_WINDOW_SECONDS + BREAK_GRACE_SECONDS)
    missed = AdBreakLog.objects.filter(result=AdBreakLog.Result.MISSED, detail="opened; awaiting engine confirmation", scheduled_for__lte=cutoff)
    count = 0
    for log in missed:
        log.result = AdBreakLog.Result.MISSED
        log.detail = "no engine confirmation within window"
        log.save(update_fields=["result", "detail"])
        count += 1
        record_health_event(
            HealthEvent.Source.BROADCAST,
            "ad_break_missed",
            f"Scheduled ad break for campaign '{log.campaign.name}' at {log.scheduled_for.isoformat()} was not confirmed as played.",
            severity=HealthEvent.Severity.WARNING,
            campaign_id=str(log.campaign_id),
        )
    return count


def scheduled_vs_played(since_days: int = 30) -> dict:
    """Analytics: scheduled vs actually played breaks (measured data only)."""
    since = timezone.now() - timedelta(days=since_days)
    logs = AdBreakLog.objects.filter(scheduled_for__gte=since)
    return {
        "window_days": since_days,
        "scheduled": logs.count(),
        "played": logs.filter(result__in=[AdBreakLog.Result.PLAYED, AdBreakLog.Result.PARTIAL]).count(),
        "missed": logs.filter(result=AdBreakLog.Result.MISSED).count(),
        "seconds_played": logs.aggregate(s=Sum("seconds_played"))["s"] or 0,
    }


# ---------------------------------------------------------------------------
# Schedule conflict detection
# ---------------------------------------------------------------------------

def find_schedule_conflicts(campaign: AudioCampaign, schedule: AdSchedule, horizon_days: int = 28) -> list[dict]:
    """Detect overlapping break windows with the campaign's other schedules.

    Enumerates every occurrence of both schedules inside the horizon and
    reports any pair whose windows (start → start + max break + grace)
    overlap. Used on schedule save and by the admin 'review scheduling
    conflicts' view.
    """
    at = timezone.now()
    horizon_end = at + timedelta(days=horizon_days)
    conflicts = []
    others = AdSchedule.objects.filter(campaign=campaign, enabled=True).exclude(pk=schedule.pk)
    own_windows = list(iter_occurrences(schedule, at, horizon_end))
    for other in others:
        for a in own_windows:
            for b in iter_occurrences(other, at, horizon_end):
                if a[0] < b[1] and b[0] < a[1]:
                    conflicts.append(
                        {
                            "with_schedule_id": str(other.id),
                            "with_starts_at": other.starts_at.isoformat(),
                            "overlap_start": max(a[0], b[0]).isoformat(),
                            "overlap_end": min(a[1], b[1]).isoformat(),
                        }
                    )
                    break
            else:
                continue
            break
    return conflicts

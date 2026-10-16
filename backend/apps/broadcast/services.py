"""Broadcast service layer.

The Liquidsoap engine is the authority for what is on air. These services
mirror engine reports into the database and build the payloads the website
consumes. Nothing here fabricates playback state: when the engine has not
reported, status is honestly "offline"/"unknown".
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.common.models import HealthEvent, StationSettings, record_health_event

from .models import BroadcastHistory, BroadcastState, OffAirTrack, Playlist, Track

logger = logging.getLogger("apps")

# If the engine stops heartbeating for this long, treat the stream as offline.
ENGINE_STALE_SECONDS = 90


def get_state() -> BroadcastState:
    state, _ = BroadcastState.objects.get_or_create(id=1)
    return state


def engine_is_online(state: BroadcastState | None = None) -> bool:
    state = state or get_state()
    if not state.engine_online or not state.last_heartbeat:
        return False
    age = timezone.now() - state.last_heartbeat
    return age <= timedelta(seconds=ENGINE_STALE_SECONDS)


@transaction.atomic
def ingest_metadata(payload: dict) -> BroadcastState:
    """Record a now-playing report from the broadcast engine.

    Called by Liquidsoap on every track change. Closes out the previous
    history row and opens a new one for the current item.
    """
    state = get_state()
    now = timezone.now()
    started_at = payload.get("started_at") or now
    if isinstance(started_at, (int, float)):
        # Engines may report Unix epoch seconds instead of an ISO string.
        from datetime import datetime, timezone as dt_timezone

        started_at = datetime.fromtimestamp(started_at, tz=dt_timezone.utc)

    state.kind = payload.get("kind", "music")
    state.title = payload.get("title", "") or ""
    state.artist = payload.get("artist", "") or ""
    state.album = payload.get("album", "") or ""
    state.artwork_url = payload.get("artwork_url", "") or ""
    state.started_at = started_at
    state.duration_seconds = max(0, int(payload.get("duration_seconds") or 0))
    state.engine_online = True
    state.last_heartbeat = now

    track = None
    track_id = payload.get("track_id")
    if track_id:
        track = Track.objects.filter(id=track_id).first()
    if track is None and state.kind == "music" and state.title:
        track = (
            Track.objects.filter(enabled=True, title__iexact=state.title)
            .filter(Q(artist__iexact=state.artist) | Q(artist=""))
            .first()
        )
    state.track = track
    state.save()

    BroadcastHistory.objects.create(
        kind=state.kind,
        title=state.title or "(unknown)",
        artist=state.artist,
        album=state.album,
        track=track,
        ref_id=str(payload.get("ref_id", "") or ""),
        started_at=started_at,
        duration_seconds=state.duration_seconds,
    )

    # Clear the stale-heartbeat alarm if it was open.
    HealthEvent.objects.filter(source=HealthEvent.Source.BROADCAST, code="heartbeat_stale", resolved=False).update(resolved=True)
    return state


def heartbeat(kind: str = "music") -> BroadcastState:
    """Lightweight keepalive from the engine (also marks the engine online)."""
    state = get_state()
    state.engine_online = True
    state.last_heartbeat = timezone.now()
    state.save(update_fields=["engine_online", "last_heartbeat", "updated_at"])
    return state


def update_listeners(count: int | None) -> None:
    state = get_state()
    state.listeners = count
    state.listeners_measured_at = timezone.now() if count is not None else None
    state.save(update_fields=["listeners", "listeners_measured_at", "updated_at"])


def check_engine_health() -> None:
    """Record a health event when the engine has gone quiet. Idempotent-ish."""
    state = get_state()
    if state.last_heartbeat is None:
        return  # engine has never connected; streaming infra simply not configured
    if not engine_is_online(state):
        record_health_event(
            HealthEvent.Source.BROADCAST,
            "heartbeat_stale",
            "Broadcast engine has not reported for more than "
            f"{ENGINE_STALE_SECONDS}s — the stream may be interrupted.",
            detail={"last_heartbeat": state.last_heartbeat.isoformat()},
        )


def build_status_payload() -> dict:
    """Public now-playing payload. Uses server clock; never client-derived."""
    from django.conf import settings

    state = get_state()
    now = timezone.now()
    online = engine_is_online(state)

    position = None
    if online and state.started_at and state.duration_seconds:
        elapsed = (now - state.started_at).total_seconds()
        if 0 <= elapsed <= state.duration_seconds + 5:
            position = round(elapsed, 1)

    artwork = state.artwork_url
    if not artwork and state.track_id and state.track.artwork:
        artwork = state.track.artwork.url

    return {
        "live": online,
        "broadcast_enabled": StationSettings.get().broadcast_enabled,
        "server_time": now.isoformat(),
        "kind": state.kind,
        "title": state.title or None,
        "artist": state.artist or None,
        "album": state.album or None,
        "artwork_url": artwork or None,
        "started_at": state.started_at.isoformat() if state.started_at else None,
        "duration_seconds": state.duration_seconds or None,
        "position_seconds": position,
        "station_time": now.astimezone().strftime("%H:%M:%S"),
        "broadcast_date": now.date().isoformat(),
        "timezone": settings.STATION_TIMEZONE,
        "listeners": state.listeners if state.listeners is not None else None,
        "listeners_measured": state.listeners is not None,
        "stream_url": settings.STREAM_PUBLIC_URL,
        "track_id": str(state.track_id) if state.track_id else None,
    }


def export_playlist_m3u(playlist: Playlist | None = None) -> list[str]:
    """M3U lines (EXTINF metadata + absolute URL) for Liquidsoap's playlist().

    The engine lives outside the web process, so every entry must be an
    absolute URL it can fetch (PUBLIC_BACKEND_URL), not a site-relative path.
    EXTINF carries the duration and "Artist - Title" display text; Liquidsoap
    parses it (splitting artist/title on " - ") and reports it on every track
    change, which is what fills now-playing on the website.
    """
    from apps.common.utils import public_media_url

    def _lines_for_tracks(tracks) -> list[str]:
        lines: list[str] = []
        for track in tracks:
            if not track.audio_file:
                continue
            # EXTINF must stay a single line — collapse any newlines in tags.
            artist = " ".join((track.artist or "").split())
            title = " ".join((track.title or "").split())
            display = f"{artist} - {title}" if artist and title else (title or artist or "Unknown")
            lines.append(f"#EXTINF:{int(track.duration_seconds or 0)},{display}")
            lines.append(public_media_url(track.audio_file.url))
        return lines

    def _lines_for(candidate: Playlist) -> list[str]:
        entries = candidate.entries.select_related("track").filter(track__enabled=True).order_by("position")
        return _lines_for_tracks(entry.track for entry in entries)

    if playlist is None:
        # Seasonal/one-off override (admin "Play playlist now"): while set,
        # the engine's rotation comes from that playlist only.
        state = get_state()
        override = state.override_playlist
        if override is not None and override.enabled:
            lines = _lines_for(override)
            if lines:
                return lines
        # Prefer the default rotation, but never serve an empty list when a
        # populated fallback (or any other enabled playlist) exists — an
        # empty m3u means the engine has nothing to play.
        candidates = Playlist.objects.filter(enabled=True).order_by("-is_default", "-is_fallback")
        for candidate in candidates:
            lines = _lines_for(candidate)
            if lines:
                return lines
        # Last resort: the raw music library — a freshly uploaded track must
        # air even before anyone builds a playlist around it.
        return _lines_for_tracks(Track.objects.filter(enabled=True).exclude(audio_file=""))
    return _lines_for(playlist)


def export_offair_m3u() -> list[str]:
    """M3U of the waiting songs the admin uploaded for the off-air state.

    Empty when none exist — the engine then plays its local silence file,
    so the stream never dies even with nothing queued.
    """
    from apps.common.utils import public_media_url

    lines: list[str] = []
    for item in OffAirTrack.objects.all():
        if not item.audio_file:
            continue
        title = " ".join((item.title or item.audio_file.name.rsplit("/", 1)[-1]).split())
        lines.append(f"#EXTINF:0,{title}")
        lines.append(public_media_url(item.audio_file.url))
    return lines


def request_force_play(track: Track) -> BroadcastState:
    """Admin "Play now": queue a track to interrupt the stream once.

    The engine claims it via GET /api/internal/force-play/ (which stamps
    force_started_at); until then a newer request simply replaces it.
    """
    if not track.enabled:
        raise ValueError("Enable the track before forcing it on air.")
    if not track.audio_file:
        raise ValueError("This track has no audio file.")
    state = get_state()
    state.force_track = track
    state.force_requested_at = timezone.now()
    state.force_started_at = None
    state.save(update_fields=["force_track", "force_requested_at", "force_started_at"])
    return state


def build_force_play_payload() -> dict:
    """Hand the pending forced track to the engine — claimed on first read.

    Returns {"active": False} when nothing is pending, the track is unusable,
    or the broadcast is off (a forced track must never break the off-air loop;
    it airs once the broadcast is switched back on and the engine re-polls).
    """
    state = get_state()
    track = state.force_track
    if (
        track is None
        or state.force_started_at is not None
        or not track.enabled
        or not track.audio_file
        or not StationSettings.get().broadcast_enabled
    ):
        return {"active": False}

    from apps.common.utils import public_media_url

    state.force_started_at = timezone.now()
    state.save(update_fields=["force_started_at"])
    return {
        "active": True,
        "uri": public_media_url(track.audio_file.url),
        "title": track.title,
        "artist": track.artist,
        "duration_seconds": int(track.duration_seconds or 0),
        "requested_at": state.force_requested_at.isoformat() if state.force_requested_at else "",
    }


def request_playlist_override(playlist: Playlist) -> BroadcastState:
    """Admin "Play playlist now" (e.g. a Christmas playlist).

    While set, export_playlist_m3u() serves this playlist instead of the
    normal rotation. The engine picks the new list up on its next m3u
    reload (~15s); stop_playlist_override() reverts to the normal rotation
    the same way.
    """
    if not playlist.enabled:
        raise ValueError("Enable the playlist before putting it on air.")
    if not playlist.entries.filter(track__enabled=True).exclude(track__audio_file="").exists():
        raise ValueError("Add at least one track with audio before putting this playlist on air.")
    state = get_state()
    state.override_playlist = playlist
    state.override_started_at = timezone.now()
    state.save(update_fields=["override_playlist", "override_started_at"])
    return state


def stop_playlist_override() -> BroadcastState:
    """Clear the on-air playlist override — normal rotation resumes."""
    state = get_state()
    state.override_playlist = None
    state.override_started_at = None
    state.save(update_fields=["override_playlist", "override_started_at"])
    return state


def playlist_override_status() -> dict:
    """Snapshot for the admin overview / status payloads."""
    state = get_state()
    playlist = state.override_playlist
    return {
        "active": playlist is not None,
        "playlist_id": str(playlist.id) if playlist else None,
        "playlist_name": playlist.name if playlist else None,
        "started_at": state.override_started_at.isoformat() if state.override_started_at else None,
    }

"""Broadcast domain models.

One authoritative broadcast timeline is produced by the Liquidsoap engine and
mirrored into BroadcastState by the internal ingest endpoints. BroadcastHistory
is the append-only record of everything actually aired.
"""
import uuid

from django.db import models

from apps.common.models import TimeStampedModel


class Track(TimeStampedModel):
    """A music track in the station library."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    artist = models.CharField(max_length=255, blank=True, default="")
    album = models.CharField(max_length=255, blank=True, default="")
    audio_file = models.FileField(upload_to="tracks/%Y/%m/", max_length=500)
    duration_seconds = models.PositiveIntegerField(default=0)
    artwork = models.ImageField(upload_to="artwork/%Y/%m/", null=True, blank=True, max_length=500)
    enabled = models.BooleanField(default=True)

    # Music licensing bookkeeping (kept honest: unknowns stay blank, not fake)
    isrc = models.CharField(max_length=64, blank=True, default="", verbose_name="ISRC")
    label = models.CharField(max_length=160, blank=True, default="")
    licensing_notes = models.TextField(blank=True, default="")
    permitted_territories = models.JSONField(
        default=list, blank=True,
        help_text="ISO country codes permitted for playback; empty = worldwide/unrestricted.",
    )
    explicit = models.BooleanField(default=False)

    class Meta:
        ordering = ["title", "artist"]
        indexes = [models.Index(fields=["enabled"])]

    def __str__(self) -> str:
        return f"{self.title} — {self.artist}"

    def delete(self, *args, **kwargs):
        """Row first, then the stored files — a deleted track frees its disk."""
        files = [f for f in (self.audio_file, self.artwork) if f]
        super().delete(*args, **kwargs)
        for f in files:
            f.delete(save=False)

    @property
    def territories_display(self) -> str:
        return ", ".join(self.permitted_territories) if self.permitted_territories else "Worldwide"


class Playlist(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")
    is_default = models.BooleanField(default=False, help_text="Used as the main rotation playlist.")
    is_fallback = models.BooleanField(default=False, help_text="Used when the main playlist cannot provide a track.")
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class PlaylistEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name="entries")
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name="playlist_entries")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position"]
        unique_together = [("playlist", "track")]
        indexes = [models.Index(fields=["playlist", "position"])]

    def __str__(self) -> str:
        return f"{self.playlist.name} #{self.position}: {self.track}"


class BroadcastState(models.Model):
    """Singleton mirror of the engine's current output.

    Written only by the internal ingest endpoint (authenticated with the
    broadcast API key), never fabricated by the website.
    """

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    kind = models.CharField(
        max_length=16,
        choices=[("music", "Music"), ("advert", "Advertisement"), ("fallback", "Fallback")],
        default="music",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    artist = models.CharField(max_length=255, blank=True, default="")
    album = models.CharField(max_length=255, blank=True, default="")
    track = models.ForeignKey(Track, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    artwork_url = models.CharField(max_length=500, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True, help_text="UTC instant the current item began airing.")
    duration_seconds = models.PositiveIntegerField(default=0)
    listeners = models.IntegerField(null=True, blank=True, help_text="Measured by Icecast; null = unknown.")
    listeners_measured_at = models.DateTimeField(null=True, blank=True)
    engine_online = models.BooleanField(default=False)
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    # Admin "Play now": the most recent forced track and when the engine
    # claimed it (null = still waiting to be handed over).
    force_track = models.ForeignKey(
        Track, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    force_requested_at = models.DateTimeField(null=True, blank=True)
    force_started_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Broadcast state"

    def __str__(self) -> str:
        return f"{self.kind}: {self.title} @ {self.started_at}"


class BroadcastHistory(models.Model):
    """Append-only log of items actually aired, written by the engine."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(
        max_length=16,
        choices=[("music", "Music"), ("advert", "Advertisement"), ("fallback", "Fallback")],
        default="music",
    )
    title = models.CharField(max_length=255)
    artist = models.CharField(max_length=255, blank=True, default="")
    album = models.CharField(max_length=255, blank=True, default="")
    track = models.ForeignKey(Track, null=True, blank=True, on_delete=models.SET_NULL, related_name="airings")
    ref_id = models.CharField(max_length=64, blank=True, default="", help_text="Engine request/ad reference.")
    started_at = models.DateTimeField(db_index=True)
    duration_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["kind", "-started_at"])]

    def __str__(self) -> str:
        return f"[{self.kind}] {self.title} @ {self.started_at}"

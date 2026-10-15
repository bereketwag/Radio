"""Advertising domain models.

Visual banners rotate on the website; audio adverts are inserted into the live
stream by the broadcast engine at scheduled break times. Eligibility is always
computed from approval state, payment state, and the campaign window — expired
or unapproved campaigns are never served.
"""
import uuid

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class Advertiser(TimeStampedModel):
    """A business that advertises on the station (may own a user account)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="advertisers"
    )
    name = models.CharField(max_length=160)
    contact_name = models.CharField(max_length=160, blank=True, default="")
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True, default="")
    website = models.URLField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class AdRequest(TimeStampedModel):
    """Public 'Request an Advertisement' form submission (not yet approved)."""

    class Format(models.TextChoices):
        BANNER = "banner", "Side label banner advertising"
        AUDIO = "audio", "Mid-break voice (audio) advertising"
        MODAL = "modal", "Modal takeover advertising"
        BOTH = "both", "Multiple formats"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business_name = models.CharField(max_length=160)
    contact_name = models.CharField(max_length=160)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True, default="")
    website = models.URLField(blank=True, default="")
    ad_format = models.CharField(max_length=16, choices=Format.choices)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    target_audience = models.CharField(max_length=255, blank=True, default="", help_text="Audience or geography.")
    estimated_budget = models.CharField(max_length=64, blank=True, default="")
    message = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    status_note = models.TextField(blank=True, default="")
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="handled_ad_requests"
    )
    handled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.business_name} ({self.ad_format})"


class CampaignStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING = "pending", "Pending approval"
    APPROVED = "approved", "Approved"
    ACTIVE = "active", "Active"
    PAUSED = "paused", "Paused"
    REJECTED = "rejected", "Rejected"
    EXPIRED = "expired", "Expired"


class PaymentStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PENDING = "pending", "Payment pending"
    PAID = "paid", "Paid"


class VisualCampaign(TimeStampedModel):
    """A rotating banner advertisement."""

    class Placement(models.TextChoices):
        SIDEBAR = "sidebar", "Side label (player panel)"
        BELOW_PLAYER = "below_player", "Below player"
        MODAL = "modal", "Modal takeover (full-screen interstitial)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    advertiser = models.ForeignKey(Advertiser, on_delete=models.CASCADE, related_name="visual_campaigns")
    name = models.CharField(max_length=160)
    banner_image = models.ImageField(
        upload_to="banners/%Y/%m/", max_length=500, null=True, blank=True,
        help_text="Creative. A campaign without one stays a draft and never serves.",
    )
    destination_url = models.URLField()
    placement = models.CharField(max_length=32, choices=Placement.choices, default=Placement.SIDEBAR)
    priority = models.PositiveSmallIntegerField(default=5, help_text="Higher rotates more often (1-10).")
    status = models.CharField(max_length=16, choices=CampaignStatus.choices, default=CampaignStatus.DRAFT)
    payment_status = models.CharField(max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    impressions = models.PositiveIntegerField(default=0)
    clicks = models.PositiveIntegerField(default=0)
    request = models.ForeignKey(
        AdRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name="visual_campaigns"
    )

    class Meta:
        ordering = ["-priority", "-created_at"]
        indexes = [models.Index(fields=["status", "starts_at", "ends_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.advertiser.name})"

    def delete(self, *args, **kwargs):
        """Row first, then the stored banner — deleting frees its disk."""
        banner = self.banner_image if self.banner_image else None
        super().delete(*args, **kwargs)
        if banner:
            banner.delete(save=False)

    def is_eligible(self, at=None) -> bool:
        """Approved, paid-enough, active-status, inside campaign window.

        A campaign with no creative uploaded stays a draft: it can exist (so
        an approved request can be turned into a shell and finished later)
        but is never served to listeners.
        """
        from django.utils import timezone

        at = at or timezone.now()
        if not self.banner_image:
            return False
        if self.status not in {CampaignStatus.APPROVED, CampaignStatus.ACTIVE}:
            return False
        if self.payment_status == PaymentStatus.UNPAID:
            return False
        if self.starts_at and at < self.starts_at:
            return False
        if self.ends_at and at > self.ends_at:
            return False
        return True


class AudioAdvert(TimeStampedModel):
    """An uploaded advertisement audio file owned by an audio campaign."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=160)
    audio_file = models.FileField(upload_to="ads/audio/%Y/%m/", max_length=500)
    duration_seconds = models.PositiveIntegerField(default=0)
    approved = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def delete(self, *args, **kwargs):
        """Row first, then the stored file — deleting a spot frees its disk."""
        audio = self.audio_file if self.audio_file else None
        super().delete(*args, **kwargs)
        if audio:
            audio.delete(save=False)


class AudioCampaign(TimeStampedModel):
    """A sponsor's scheduled audio advertising campaign."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    advertiser = models.ForeignKey(Advertiser, on_delete=models.CASCADE, related_name="audio_campaigns")
    name = models.CharField(max_length=160)
    adverts = models.ManyToManyField(AudioAdvert, related_name="campaigns", blank=True)
    status = models.CharField(max_length=16, choices=CampaignStatus.choices, default=CampaignStatus.DRAFT)
    payment_status = models.CharField(max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    starts_at = models.DateTimeField(null=True, blank=True, help_text="Campaign start (UTC).")
    ends_at = models.DateTimeField(null=True, blank=True, help_text="Campaign end (UTC).")
    priority = models.PositiveSmallIntegerField(default=5, help_text="Break selection priority (1-10).")
    request = models.ForeignKey(
        AdRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name="audio_campaigns"
    )

    class Meta:
        ordering = ["-priority", "-created_at"]
        indexes = [models.Index(fields=["status", "starts_at", "ends_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.advertiser.name})"

    def is_eligible(self, at=None) -> bool:
        from django.utils import timezone

        at = at or timezone.now()
        if self.status not in {CampaignStatus.APPROVED, CampaignStatus.ACTIVE}:
            return False
        if self.payment_status == PaymentStatus.UNPAID:
            return False
        if self.starts_at and at < self.starts_at:
            return False
        if self.ends_at and at > self.ends_at:
            return False
        return bool(self.adverts.filter(approved=True, active=True).exists())


class AdSchedule(models.Model):
    """When an audio campaign's breaks occur.

    Recurrence is expressed in the station timezone (STATION_TIMEZONE); all
    stored instants are UTC. One-time schedules use a single datetime; daily
    and weekly recur between campaign start/end dates.
    """

    class Recurrence(models.TextChoices):
        ONCE = "once", "One-time"
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(AudioCampaign, on_delete=models.CASCADE, related_name="schedules")
    recurrence = models.CharField(max_length=8, choices=Recurrence.choices, default=Recurrence.DAILY)
    # For ONCE: exact UTC datetime. For DAILY/WEEKLY: local station time-of-day.
    starts_at = models.DateTimeField(help_text="UTC datetime of the break (one-time).")
    local_time = models.TimeField(null=True, blank=True, help_text="Station-local break time (daily/weekly).")
    weekday = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="0=Monday … 6=Sunday (weekly recurrence)."
    )
    max_break_seconds = models.PositiveSmallIntegerField(default=60, help_text="Maximum break duration.")
    enabled = models.BooleanField(default=True)
    # Set by the scheduler when a break window opens; used to avoid overlaps.
    last_run_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["starts_at"]
        indexes = [models.Index(fields=["enabled", "starts_at"])]

    def __str__(self) -> str:
        return f"{self.campaign.name} @ {self.starts_at}"


class AdBreakLog(models.Model):
    """Actual broadcast log of an ad break (scheduled vs played)."""

    class Result(models.TextChoices):
        PLAYED = "played", "Played"
        PARTIAL = "partial", "Partially played"
        MISSED = "missed", "Missed"
        SKIPPED = "skipped", "Skipped (overlap/ ineligible)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    schedule = models.ForeignKey(AdSchedule, null=True, blank=True, on_delete=models.SET_NULL, related_name="break_logs")
    campaign = models.ForeignKey(AudioCampaign, on_delete=models.CASCADE, related_name="break_logs")
    scheduled_for = models.DateTimeField(db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    result = models.CharField(max_length=16, choices=Result.choices, default=Result.MISSED)
    seconds_played = models.PositiveIntegerField(default=0)
    adverts_played = models.ManyToManyField(AudioAdvert, related_name="break_plays", blank=True)
    detail = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-scheduled_for"]

    def __str__(self) -> str:
        return f"{self.campaign.name} {self.scheduled_for} [{self.result}]"


class ImpressionEvent(models.Model):
    """A measured banner impression (served to a real viewer)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(VisualCampaign, on_delete=models.CASCADE, related_name="impression_events")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    session_key = models.CharField(max_length=64, blank=True, default="")
    ip_hash = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]


class ClickEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(VisualCampaign, on_delete=models.CASCADE, related_name="click_events")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    session_key = models.CharField(max_length=64, blank=True, default="")
    ip_hash = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

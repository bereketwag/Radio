"""Business rule tests: schedule conflicts, break windows, missed breaks."""
from datetime import time, timedelta, timezone as dt_timezone

from django.test import TestCase
from django.utils import timezone

from apps.advertising import services
from apps.advertising.models import (
    AdBreakLog,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    PaymentStatus,
)


class ScheduleFixture(TestCase):
    def setUp(self):
        self.advertiser = Advertiser.objects.create(name="Sched Co", email="s@example.com")
        self.campaign = AudioCampaign.objects.create(
            advertiser=self.advertiser,
            name="Campaign A",
            status=CampaignStatus.ACTIVE,
            payment_status=PaymentStatus.PAID,
            starts_at=timezone.now() - timedelta(days=1),
            ends_at=timezone.now() + timedelta(days=30),
            priority=5,
        )
        # A campaign is only break-eligible with at least one approved, active advert.
        self.advert = AudioAdvert.objects.create(name="Spot", duration_seconds=30, approved=True, active=True)
        self.campaign.adverts.add(self.advert)

    def make_schedule(self, **overrides):
        defaults = dict(
            campaign=self.campaign,
            recurrence=AdSchedule.Recurrence.DAILY,
            local_time=time(12, 0),
            starts_at=timezone.now(),
            max_break_seconds=60,
        )
        defaults.update(overrides)
        return AdSchedule.objects.create(**defaults)


class ScheduleConflictTests(ScheduleFixture):
    def test_no_conflict_for_single_schedule(self):
        s = self.make_schedule()
        self.assertEqual(services.find_schedule_conflicts(self.campaign, s), [])

    def test_daily_same_time_conflicts(self):
        a = self.make_schedule()
        b = self.make_schedule(local_time=time(12, 0), max_break_seconds=45)
        conflicts = services.find_schedule_conflicts(self.campaign, b)
        self.assertTrue(any(c["with_schedule_id"] == str(a.id) for c in conflicts))

    def test_daily_different_time_no_conflict(self):
        self.make_schedule(local_time=time(9, 0))
        b = self.make_schedule(local_time=time(18, 0))
        self.assertEqual(services.find_schedule_conflicts(self.campaign, b), [])

    def test_weekly_same_weekday_time_conflicts(self):
        # Use the station-local weekday "today" so both land on the same day.
        tz = dt_timezone.utc
        today = timezone.now().astimezone(tz).weekday()
        a = self.make_schedule(recurrence=AdSchedule.Recurrence.WEEKLY, weekday=today, local_time=time(12, 0))
        b = self.make_schedule(recurrence=AdSchedule.Recurrence.WEEKLY, weekday=today, local_time=time(12, 0))
        conflicts = services.find_schedule_conflicts(self.campaign, b)
        self.assertTrue(any(c["with_schedule_id"] == str(a.id) for c in conflicts))

    def test_weekly_different_weekday_no_conflict(self):
        today = timezone.now().weekday()
        self.make_schedule(recurrence=AdSchedule.Recurrence.WEEKLY, weekday=today, local_time=time(12, 0))
        b = self.make_schedule(
            recurrence=AdSchedule.Recurrence.WEEKLY, weekday=(today + 3) % 7, local_time=time(12, 0)
        )
        self.assertEqual(services.find_schedule_conflicts(self.campaign, b), [])


class BreakWindowTests(ScheduleFixture):
    def test_daily_window_opens_at_local_time(self):
        self.make_schedule(local_time=time(12, 0), max_break_seconds=60)
        # 12:00 UTC == station tz UTC by default in tests
        at = timezone.now().replace(hour=12, minute=0, second=10, microsecond=0)
        if at < timezone.now():
            at += timedelta(days=1)
        breaks = services.active_breaks(at=at)
        self.assertTrue(len(breaks) >= 1)

    def test_window_closed_outside_break(self):
        self.make_schedule(local_time=time(12, 0))
        at = timezone.now().replace(hour=3, minute=0, second=0, microsecond=0)
        self.assertEqual(services.active_breaks(at=at), [])


class MissedBreakTests(ScheduleFixture):
    def test_break_log_created_when_window_opens(self):
        self.make_schedule(local_time=time(12, 0), max_break_seconds=60)
        at = timezone.now().replace(hour=12, minute=0, second=5, microsecond=0)
        if at < timezone.now():
            at += timedelta(days=1)
        payload = services.build_ad_break_payload(at=at)
        self.assertTrue(payload["active"])
        self.assertEqual(AdBreakLog.objects.count(), 1)

    def test_break_payload_always_carries_schedule_id(self):
        # The engine parses every poll with a fixed record type — an inactive
        # payload without schedule_id would make each response unreadable.
        closed = timezone.now().replace(hour=3, minute=0, second=0, microsecond=0)
        inactive = services.build_ad_break_payload(at=closed)
        self.assertIn("schedule_id", inactive)
        self.assertEqual(inactive["schedule_id"], "")

        self.make_schedule(local_time=time(12, 0), max_break_seconds=60)
        at = timezone.now().replace(hour=12, minute=0, second=5, microsecond=0)
        if at < timezone.now():
            at += timedelta(days=1)
        active = services.build_ad_break_payload(at=at)
        self.assertTrue(active["active"])
        self.assertTrue(active["schedule_id"])
        # Once confirmed, the window closes but the key stays present.
        log = AdBreakLog.objects.get()
        log.result = AdBreakLog.Result.PLAYED
        log.save()
        after = services.build_ad_break_payload(at=at)
        self.assertFalse(after["active"])
        self.assertIn("schedule_id", after)

    def test_window_stays_open_until_break_confirmed(self):
        self.make_schedule(local_time=time(12, 0), max_break_seconds=60)
        at = timezone.now().replace(hour=12, minute=0, second=5, microsecond=0)
        if at < timezone.now():
            at += timedelta(days=1)
        first = services.build_ad_break_payload(at=at)
        self.assertTrue(first["active"])
        # The engine polls every 15s for the whole window while waiting for
        # the next track boundary — each poll must still see the break open,
        # without spawning duplicate break logs.
        second = services.build_ad_break_payload(at=at)
        self.assertTrue(second["active"])
        self.assertEqual(AdBreakLog.objects.count(), 1)
        # Once the engine confirms a play, the window must NOT be served again.
        log = AdBreakLog.objects.get()
        log.result = AdBreakLog.Result.PLAYED
        log.save()
        third = services.build_ad_break_payload(at=at)
        self.assertFalse(third["active"])

    def test_expired_unconfirmed_break_marked_missed(self):
        schedule = self.make_schedule()
        old = timezone.now() - timedelta(hours=2)
        AdBreakLog.objects.create(
            schedule=schedule, campaign=self.campaign, scheduled_for=old,
            result=AdBreakLog.Result.MISSED, detail="opened; awaiting engine confirmation",
        )
        marked = services.close_missed_breaks()
        self.assertEqual(marked, 1)
        log = AdBreakLog.objects.get()
        self.assertIn("no engine confirmation", log.detail)

    def test_ineligible_campaign_never_opens_break(self):
        self.campaign.status = CampaignStatus.PAUSED
        self.campaign.save()
        self.make_schedule(local_time=time(12, 0))
        at = timezone.now().replace(hour=12, minute=0, second=5, microsecond=0)
        if at < timezone.now():
            at += timedelta(days=1)
        payload = services.build_ad_break_payload(at=at)
        self.assertFalse(payload["active"])


class ScheduledVsPlayedTests(ScheduleFixture):
    def test_counts_measured_data_only(self):
        schedule = self.make_schedule()
        now = timezone.now()
        AdBreakLog.objects.create(campaign=self.campaign, schedule=schedule, scheduled_for=now, result=AdBreakLog.Result.PLAYED)
        AdBreakLog.objects.create(campaign=self.campaign, schedule=schedule, scheduled_for=now, result=AdBreakLog.Result.MISSED)
        report = services.scheduled_vs_played()
        self.assertEqual(report["scheduled"], 2)
        self.assertEqual(report["played"], 1)
        self.assertEqual(report["missed"], 1)

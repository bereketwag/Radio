"""Tests for the modal placement, music statistics, engine URL building,
and ad-play confirmation fallback."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.advertising import services
from apps.advertising.models import (
    AdBreakLog,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    PaymentStatus,
    VisualCampaign,
)
from apps.accounts.models import Role, User
from apps.broadcast.models import Playlist, Track
from apps.broadcast.services import export_playlist_m3u
from apps.common.utils import public_media_url


def make_visual(name="Modal Ad", placement="modal", **overrides):
    advertiser, _ = Advertiser.objects.get_or_create(name="Co", defaults={"email": "c@example.com"})
    defaults = dict(
        advertiser=advertiser,
        # A stored name (no disk I/O): campaigns without a creative are draft
        # shells that never serve, so every serving fixture needs one.
        banner_image="banners/modal.png",
        destination_url="https://example.com",
        placement=placement,
        priority=5,
        status=CampaignStatus.ACTIVE,
        payment_status=PaymentStatus.PAID,
        starts_at=timezone.now() - timedelta(days=1),
        ends_at=timezone.now() + timedelta(days=30),
    )
    defaults.update(overrides)
    return VisualCampaign.objects.create(name=name, **defaults)


class ModalPlacementTests(TestCase):
    def test_modal_campaign_served_for_modal_placement(self):
        make_visual(placement="modal")
        result = services.eligible_visual_campaigns(placement="modal")
        self.assertEqual(len(result), 1)

    def test_modal_campaign_not_served_in_sidebar(self):
        make_visual(placement="modal")
        result = services.eligible_visual_campaigns(placement="sidebar")
        self.assertEqual(result, [])

    def test_modal_respects_expiry_like_other_placements(self):
        make_visual(ends_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(services.eligible_visual_campaigns(placement="modal"), [])


class PublicUrlTests(TestCase):
    def test_relative_media_url_becomes_absolute(self):
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            self.assertEqual(public_media_url("/media/tracks/a.wav"), "http://backend:8000/media/tracks/a.wav")

    def test_absolute_url_unchanged(self):
        self.assertEqual(public_media_url("https://cdn.example/x.mp3"), "https://cdn.example/x.mp3")

    def test_empty_url_stays_empty(self):
        self.assertEqual(public_media_url(""), "")

    def test_playlist_m3u_entries_are_absolute(self):
        track = Track.objects.create(title="T", artist="A", duration_seconds=10)
        track.audio_file.name = "tracks/t.wav"
        track.save()
        playlist = Playlist.objects.create(name="P", is_default=True)
        playlist.entries.create(track=track, position=0)
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            lines = export_playlist_m3u()
        self.assertEqual(
            lines,
            ["#EXTINF:10,A - T", "http://backend:8000/media/tracks/t.wav"],
        )

    def test_playlist_m3u_extinf_is_single_line(self):
        track = Track.objects.create(
            title="Line1\nLine2", artist="Art\nist", duration_seconds=0
        )
        track.audio_file.name = "tracks/x.wav"
        track.save()
        playlist = Playlist.objects.create(name="P2", is_default=True)
        playlist.entries.create(track=track, position=0)
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            lines = export_playlist_m3u()
        self.assertEqual(len(lines), 2)  # one EXTINF + one URL, no stray splits
        self.assertEqual(lines[0], "#EXTINF:0,Art ist - Line1 Line2")

    def test_empty_default_playlist_falls_back_to_populated_fallback(self):
        # An empty default must not starve the engine when the fallback has music.
        track = Track.objects.create(title="Keep", artist="Going", duration_seconds=5)
        track.audio_file.name = "tracks/keep.wav"
        track.save()
        Playlist.objects.create(name="Empty default", is_default=True)
        fb = Playlist.objects.create(name="Emergency", is_fallback=True)
        fb.entries.create(track=track, position=0)
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            lines = export_playlist_m3u()
        self.assertEqual(
            lines,
            ["#EXTINF:5,Going - Keep", "http://backend:8000/media/tracks/keep.wav"],
        )

    def test_populated_default_still_wins_over_fallback(self):
        default_track = Track.objects.create(title="Main", artist="Us", duration_seconds=3)
        default_track.audio_file.name = "tracks/main.wav"
        default_track.save()
        fb_track = Track.objects.create(title="Spare", artist="Them", duration_seconds=9)
        fb_track.audio_file.name = "tracks/spare.wav"
        fb_track.save()
        main = Playlist.objects.create(name="Main", is_default=True)
        main.entries.create(track=default_track, position=0)
        spare = Playlist.objects.create(name="Spare", is_fallback=True)
        spare.entries.create(track=fb_track, position=0)
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            lines = export_playlist_m3u()
        self.assertEqual(lines[1], "http://backend:8000/media/tracks/main.wav")
        self.assertEqual(len(lines), 2)

    def test_ad_break_uris_are_absolute(self):
        advertiser = Advertiser.objects.create(name="A", email="a@example.com")
        campaign = AudioCampaign.objects.create(
            advertiser=advertiser, name="C", status=CampaignStatus.ACTIVE,
            payment_status=PaymentStatus.PAID,
            starts_at=timezone.now() - timedelta(days=1), ends_at=timezone.now() + timedelta(days=30),
        )
        advert = AudioAdvert.objects.create(name="Spot", duration_seconds=30, approved=True)
        advert.audio_file.name = "ads/audio/spot.wav"
        advert.save()
        campaign.adverts.add(advert)
        schedule = campaign.schedules.create(recurrence="once", starts_at=timezone.now(), max_break_seconds=60)
        with override_settings(PUBLIC_BACKEND_URL="http://backend:8000"):
            payload = services.build_ad_break_payload(at=timezone.now())
        self.assertTrue(payload["active"])
        self.assertEqual(payload["adverts"][0]["uri"], "http://backend:8000/media/ads/audio/spot.wav")
        schedule.delete()


class AdPlayedFallbackTests(TestCase):
    def setUp(self):
        self.advertiser = Advertiser.objects.create(name="A", email="a@example.com")
        self.campaign = AudioCampaign.objects.create(
            advertiser=self.advertiser, name="C", status=CampaignStatus.ACTIVE,
            payment_status=PaymentStatus.PAID,
            starts_at=timezone.now() - timedelta(days=1), ends_at=timezone.now() + timedelta(days=30),
        )
        self.advert = AudioAdvert.objects.create(name="Spot", duration_seconds=30, approved=True)
        self.advert.audio_file.name = "ads/audio/2026/10/unique-spot.wav"
        self.advert.save()
        self.campaign.adverts.add(self.advert)

    def test_confirmation_by_advert_id(self):
        result = services.record_ad_played({"advert_id": str(self.advert.id), "duration": 30})
        self.assertTrue(result["ok"])

    def test_confirmation_by_filename_fallback(self):
        result = services.record_ad_played({"filename": "/tmp/liq/unique-spot.wav", "duration": 30})
        self.assertTrue(result["ok"])
        log = AdBreakLog.objects.get()
        self.assertIn(self.advert, log.adverts_played.all())
        self.assertEqual(log.result, AdBreakLog.Result.PLAYED)

    def test_unknown_advert_still_rejected(self):
        result = services.record_ad_played({"filename": "/tmp/nope.wav"})
        self.assertFalse(result["ok"])

    def test_confirmation_never_resurrects_expired_break(self):
        stale = AdBreakLog.objects.create(
            campaign=self.campaign,
            scheduled_for=timezone.now() - timedelta(hours=1),
            result=AdBreakLog.Result.MISSED,
            detail="opened; awaiting engine confirmation",
        )
        fresh = AdBreakLog.objects.create(
            campaign=self.campaign,
            scheduled_for=timezone.now(),
            result=AdBreakLog.Result.MISSED,
            detail="opened; awaiting engine confirmation",
        )
        result = services.record_ad_played({"advert_id": str(self.advert.id), "duration": 30})
        self.assertTrue(result["ok"])
        fresh.refresh_from_db()
        stale.refresh_from_db()
        self.assertEqual(fresh.result, AdBreakLog.Result.PLAYED)
        self.assertEqual(fresh.seconds_played, 30)
        # An hour-old missed break must stay missed — a late duplicate
        # confirmation from the engine cannot rewrite history.
        self.assertEqual(stale.result, AdBreakLog.Result.MISSED)
        self.assertEqual(stale.seconds_played, 0)

    def test_duplicate_confirmation_accumulates_on_same_break(self):
        current = AdBreakLog.objects.create(
            campaign=self.campaign,
            scheduled_for=timezone.now(),
            result=AdBreakLog.Result.MISSED,
            detail="opened; awaiting engine confirmation",
        )
        first = services.record_ad_played({"advert_id": str(self.advert.id), "duration": 30})
        self.assertTrue(first["ok"])
        second = services.record_ad_played({"advert_id": str(self.advert.id), "duration": 12})
        self.assertTrue(second["ok"])
        # One break, one row — the second metadata event only adds seconds.
        self.assertEqual(AdBreakLog.objects.count(), 1)
        current.refresh_from_db()
        self.assertEqual(current.result, AdBreakLog.Result.PLAYED)
        self.assertEqual(current.seconds_played, 42)

    def test_schedule_id_targets_exact_break(self):
        target_sched = AdSchedule.objects.create(
            campaign=self.campaign, recurrence="once",
            starts_at=timezone.now(), max_break_seconds=60,
        )
        other_sched = AdSchedule.objects.create(
            campaign=self.campaign, recurrence="once",
            starts_at=timezone.now(), max_break_seconds=60,
        )
        target = AdBreakLog.objects.create(
            schedule=target_sched, campaign=self.campaign,
            scheduled_for=timezone.now() - timedelta(minutes=1),
            result=AdBreakLog.Result.MISSED,
            detail="opened; awaiting engine confirmation",
        )
        # Newer open break of the same campaign: a campaign-wide "latest
        # missed" lookup would wrongly confirm this one instead.
        newer = AdBreakLog.objects.create(
            schedule=other_sched, campaign=self.campaign,
            scheduled_for=timezone.now(),
            result=AdBreakLog.Result.MISSED,
            detail="opened; awaiting engine confirmation",
        )
        result = services.record_ad_played(
            {"advert_id": str(self.advert.id), "schedule_id": str(target_sched.id), "duration": 30}
        )
        self.assertTrue(result["ok"])
        target.refresh_from_db()
        newer.refresh_from_db()
        self.assertEqual(target.result, AdBreakLog.Result.PLAYED)
        self.assertEqual(newer.result, AdBreakLog.Result.MISSED)


class MusicStatsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test", username="admin", password="x" * 12, role=Role.STATION_ADMIN
        )
        self.client.force_authenticate(self.admin)
        for i, seconds in enumerate([214, 189, 246]):
            t = Track.objects.create(title=f"T{i}", duration_seconds=seconds)
            t.audio_file.name = f"tracks/t{i}.wav"
            t.save()
        Track.objects.create(title="Disabled", duration_seconds=100, enabled=False)

    def test_stats_totals(self):
        resp = self.client.get("/api/admin-panel/tracks/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["total_songs"], 4)
        self.assertEqual(resp.data["enabled_songs"], 3)
        self.assertEqual(resp.data["total_seconds"], 214 + 189 + 246 + 100)
        self.assertEqual(resp.data["total_minutes"], round((214 + 189 + 246 + 100) / 60, 1))

    def test_overview_includes_music_totals(self):
        resp = self.client.get("/api/admin-panel/overview/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["music"]["total_songs"], 4)
        self.assertEqual(resp.data["music"]["enabled_songs"], 3)

    def test_stats_requires_station_admin(self):
        listener = User.objects.create_user(
            email="l@test", username="l", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(listener)
        resp = self.client.get("/api/admin-panel/tracks/stats/")
        self.assertEqual(resp.status_code, 403)

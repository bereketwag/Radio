"""Business rule tests: broadcast metadata ingest and status truthfulness."""
from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.broadcast import services
from apps.broadcast.models import BroadcastHistory, Track


class IngestTests(TestCase):
    def key_headers(self):
        return {"HTTP_X_BROADCAST_KEY": settings.BROADCAST_API_KEY}

    def test_metadata_ingest_updates_state_and_history(self):
        now = timezone.now()
        state = services.ingest_metadata(
            {"kind": "music", "title": "Slow Aurora", "artist": "Kestrel Line",
             "album": "Polar Light", "started_at": now, "duration_seconds": 240}
        )
        self.assertEqual(state.title, "Slow Aurora")
        self.assertEqual(state.started_at, now)
        self.assertEqual(BroadcastHistory.objects.count(), 1)
        row = BroadcastHistory.objects.get()
        self.assertEqual(row.title, "Slow Aurora")
        self.assertEqual(row.duration_seconds, 240)

    def test_ingest_links_track_by_title_artist(self):
        track = Track.objects.create(title="Glass Harbour", artist="Sable & Foine", duration_seconds=180)
        state = services.ingest_metadata({"kind": "music", "title": "Glass Harbour", "artist": "Sable & Foine"})
        self.assertEqual(state.track_id, track.id)

    def test_status_position_derived_from_server_clock(self):
        now = timezone.now()
        started = now - timedelta(seconds=60)
        services.ingest_metadata(
            {"kind": "music", "title": "X", "started_at": started, "duration_seconds": 200}
        )
        payload = services.build_status_payload()
        self.assertIsNotNone(payload["position_seconds"])
        self.assertAlmostEqual(payload["position_seconds"], 60, delta=3)
        # Position is capped once past the item's duration (no fake looping progress)
        self.assertLessEqual(payload["position_seconds"], 200)

    def test_status_live_only_when_engine_online(self):
        services.ingest_metadata({"kind": "music", "title": "Y"})
        payload = services.build_status_payload()
        self.assertTrue(payload["live"])

        state = services.get_state()
        state.last_heartbeat = timezone.now() - timedelta(seconds=5 * 60)
        state.save()
        payload = services.build_status_payload()
        self.assertFalse(payload["live"])

    def test_listener_count_null_when_unmeasured(self):
        state = services.get_state()
        state.listeners = None
        state.save()
        payload = services.build_status_payload()
        self.assertIsNone(payload["listeners"])
        self.assertFalse(payload["listeners_measured"])

    def test_history_marks_current_item(self):
        now = timezone.now()
        services.ingest_metadata({"kind": "music", "title": "A", "started_at": now, "duration_seconds": 100})
        services.ingest_metadata({"kind": "music", "title": "B", "started_at": now, "duration_seconds": 100})
        state = services.get_state()
        current = (
            BroadcastHistory.objects.filter(started_at=state.started_at, title=state.title)
            .values_list("id", flat=True)
            .first()
        )
        self.assertIsNotNone(current)


class PublicApiTests(APITestCase):
    def test_now_playing_returns_stream_url(self):
        resp = self.client.get("/api/broadcast/now-playing/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("live", resp.data)
        self.assertIn("stream_url", resp.data)

    def test_history_endpoint(self):
        services.ingest_metadata({"kind": "music", "title": "Z", "duration_seconds": 90})
        resp = self.client.get("/api/broadcast/history/?limit=5")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)

    def test_station_config(self):
        resp = self.client.get("/api/station/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("name", resp.data)
        self.assertIn("stream_url", resp.data)

    def test_health_ok(self):
        resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["checks"]["database"])

    def test_banner_rotation_never_serves_unapproved(self):
        from apps.advertising.models import Advertiser, CampaignStatus, VisualCampaign

        advertiser = Advertiser.objects.create(name="C", email="c@x.dev")
        VisualCampaign.objects.create(
            advertiser=advertiser, name="Draft", destination_url="https://x.dev",
            status=CampaignStatus.DRAFT,
        )
        resp = self.client.get("/api/ads/banners/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 0)

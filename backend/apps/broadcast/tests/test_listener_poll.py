"""Listener-count measurement: Icecast fetch service and internal endpoint."""
import io
import json
from unittest.mock import MagicMock, patch

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from apps.broadcast import services


def _fake_response(payload: dict) -> MagicMock:
    resp = MagicMock()
    resp.__enter__.return_value.read.return_value = json.dumps(payload).encode("utf-8")
    return resp


class PollIcecastListenersTests(TestCase):
    def setUp(self):
        services.update_listeners(5)

    @override_settings(ICECAST_STATS_URL="http://icecast.test", ICECAST_MOUNT="radio")
    def test_successful_poll_stores_count(self):
        payload = {"icestats": {"source": {"listeners": 7}}}
        with patch("urllib.request.urlopen", return_value=_fake_response(payload)) as mock_open:
            outcome, count = services.poll_icecast_listeners()
        self.assertEqual(outcome, "updated")
        self.assertEqual(count, 7)
        self.assertIn("mount=/radio", mock_open.call_args[0][0])
        state = services.get_state()
        self.assertEqual(state.listeners, 7)
        self.assertIsNotNone(state.listeners_measured_at)

    @override_settings(ICECAST_STATS_URL="http://icecast.test", ICECAST_MOUNT="radio")
    def test_source_list_payload(self):
        payload = {"icestats": {"source": [{"listeners": 2}]}}
        with patch("urllib.request.urlopen", return_value=_fake_response(payload)):
            outcome, count = services.poll_icecast_listeners()
        self.assertEqual((outcome, count), ("updated", 2))

    @override_settings(ICECAST_STATS_URL="http://icecast.test", ICECAST_MOUNT="radio")
    def test_missing_source_counts_zero(self):
        payload = {"icestats": {}}
        with patch("urllib.request.urlopen", return_value=_fake_response(payload)):
            outcome, count = services.poll_icecast_listeners()
        self.assertEqual((outcome, count), ("updated", 0))
        self.assertEqual(services.get_state().listeners, 0)

    @override_settings(ICECAST_STATS_URL="http://icecast.test", ICECAST_MOUNT="radio")
    def test_unreachable_clears_count(self):
        with patch("urllib.request.urlopen", side_effect=OSError("refused")):
            outcome, count = services.poll_icecast_listeners()
        self.assertEqual((outcome, count), ("cleared", None))
        self.assertIsNone(services.get_state().listeners)

    @override_settings(ICECAST_STATS_URL="")
    def test_unconfigured_is_skipped_without_touching_state(self):
        outcome, count = services.poll_icecast_listeners()
        self.assertEqual((outcome, count), ("skipped", None))
        self.assertEqual(services.get_state().listeners, 5)

    @override_settings(ICECAST_STATS_URL="http://icecast.test", ICECAST_MOUNT="/radio")
    def test_mount_is_normalised_to_one_slash(self):
        with patch("urllib.request.urlopen", return_value=_fake_response({"icestats": {"source": {"listeners": 1}}})) as mock_open:
            services.poll_icecast_listeners()
        self.assertIn("mount=/radio", mock_open.call_args[0][0])
        self.assertNotIn("mount=//radio", mock_open.call_args[0][0])

    @override_settings(ICECAST_STATS_URL="http://icecast.test")
    def test_poll_icecast_command_uses_service(self):
        payload = {"icestats": {"source": {"listeners": 3}}}
        out = io.StringIO()
        with patch("urllib.request.urlopen", return_value=_fake_response(payload)):
            call_command("poll_icecast", stdout=out)
        self.assertIn("Icecast listeners: 3", out.getvalue())
        self.assertEqual(services.get_state().listeners, 3)


class InternalListenersEndpointTests(APITestCase):
    def key(self):
        return {"HTTP_X_BROADCAST_KEY": settings.BROADCAST_API_KEY}

    def test_post_updates_state(self):
        resp = self.client.post("/api/internal/listeners/", {"count": 12}, format="json", **self.key())
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["ok"])
        self.assertEqual(services.get_state().listeners, 12)

    def test_post_null_clears(self):
        services.update_listeners(9)
        resp = self.client.post("/api/internal/listeners/", {"count": None}, format="json", **self.key())
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(services.get_state().listeners)

    def test_wrong_key_rejected(self):
        resp = self.client.post("/api/internal/listeners/", {"count": 4}, format="json", HTTP_X_BROADCAST_KEY="nope")
        self.assertEqual(resp.status_code, 401)
        self.assertIsNone(services.get_state().listeners)

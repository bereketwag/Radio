"""Broadcast on/off: the engine heartbeat carries the on/off switch.

While the broadcast is off the engine loops the admin's waiting songs (the
off-air m3u collection) and never touches ads or the music rotation; the
public payload must reflect the state so the site can show OFF AIR.
"""
from django.conf import settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.common.models import StationSettings


class BroadcastToggleTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@toggle.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.client.force_authenticate(self.admin)
        self.key = settings.BROADCAST_API_KEY

    def engine_heartbeat(self):
        """POST the heartbeat exactly like the engine does (broadcast key)."""
        self.client.force_authenticate(user=None)
        return self.client.post(
            "/api/internal/heartbeat/",
            {"kind": "music", "engine_online": True},
            format="json",
            HTTP_X_BROADCAST_KEY=self.key,
        )

    def test_heartbeat_carries_default_on_state(self):
        resp = self.engine_heartbeat()
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["broadcast_enabled"])

    def test_heartbeat_follows_admin_toggle(self):
        resp = self.client.patch("/api/admin-panel/station-settings/", {"broadcast_enabled": False})
        self.assertEqual(resp.status_code, 200, resp.data)
        engine = self.engine_heartbeat()
        self.assertFalse(engine.data["broadcast_enabled"])

    def test_now_playing_reports_broadcast_state(self):
        cfg = StationSettings.get()
        cfg.broadcast_enabled = False
        cfg.save()
        resp = self.client.get("/api/broadcast/now-playing/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["broadcast_enabled"])

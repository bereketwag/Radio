"""Broadcast on/off: the engine heartbeat carries the switch and the off-air track URL.

While the broadcast is off the engine must loop the admin-uploaded track (or
local silence) and never touch ads or the music rotation; the public payload
must reflect the state so the site can show OFF AIR.
"""
import io
import tempfile
import wave

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.common.models import StationSettings

MEDIA = tempfile.mkdtemp(prefix="aurora-offair-media-")


def wav_upload(name: str = "off-air.wav") -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * 8000)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
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
        self.assertEqual(resp.data["fallback_uri"], "")

    def test_heartbeat_follows_admin_toggle(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch("/api/admin-panel/station-settings/", {"broadcast_enabled": False})
        self.assertEqual(resp.status_code, 200, resp.data)
        engine = self.engine_heartbeat()
        self.assertFalse(engine.data["broadcast_enabled"])

    def test_fallback_upload_flows_to_the_engine_as_absolute_uri(self):
        resp = self.client.patch(
            "/api/admin-panel/station-settings/",
            {"fallback_audio": wav_upload()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data["fallback_audio_url"].startswith(settings.MEDIA_URL))

        engine = self.engine_heartbeat()
        self.assertTrue(engine.data["fallback_uri"].startswith(settings.PUBLIC_BACKEND_URL))
        self.assertIn("off-air.wav", engine.data["fallback_uri"])

    def test_now_playing_reports_broadcast_state(self):
        cfg = StationSettings.get()
        cfg.broadcast_enabled = False
        cfg.save()
        resp = self.client.get("/api/broadcast/now-playing/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["broadcast_enabled"])

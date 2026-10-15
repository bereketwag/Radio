"""Admin "Play now" + rotation honesty: library tracks must reach the stream.

Covers the full chain the operator relies on:
  - uploaded library tracks appear in the engine m3u even when no playlist
    has entries (fresh stations must air music immediately),
  - clicking Play now queues the track, the engine claims it exactly once,
  - a forced track never breaks the off-air loop while the broadcast is off.
"""
import io
import tempfile
import wave

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.broadcast.models import Track

MEDIA = tempfile.mkdtemp(prefix="aurora-playnow-media-")


def wav_upload(name: str = "air.wav") -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * 8000)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class PlayNowTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@playnow.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.listener = User.objects.create_user(
            email="listener@playnow.test", username="listener", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)
        self.key = settings.BROADCAST_API_KEY
        self.track = Track.objects.create(
            title="Forced Song", artist="The Admins", duration_seconds=3, audio_file=wav_upload("forced.wav")
        )

    def engine_get(self, path: str):
        self.client.force_authenticate(user=None)
        return self.client.get(path, HTTP_X_BROADCAST_KEY=self.key)

    def test_m3u_falls_back_to_library_when_playlists_are_empty(self):
        resp = self.engine_get("/api/internal/playlist.m3u")
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn("#EXTINF:", body)
        self.assertIn("The Admins - Forced Song", body)
        self.assertIn(".wav", body)  # Django may rename duplicates (forced_xxxx.wav)

    def test_disabled_library_tracks_never_reach_the_m3u(self):
        self.track.enabled = False
        self.track.save(update_fields=["enabled"])
        body = self.engine_get("/api/internal/playlist.m3u").content.decode()
        self.assertNotIn("forced.wav", body)

    def test_play_now_is_claimed_by_the_engine_exactly_once(self):
        resp = self.client.post(f"/api/admin-panel/tracks/{self.track.id}/play_now/")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data["ok"])
        self.assertTrue(resp.data["broadcast_enabled"])

        first = self.engine_get("/api/internal/force-play/")
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data["active"])
        self.assertIn("forced", first.data["uri"])  # may be renamed forced_<rand>.wav
        self.assertTrue(first.data["uri"].startswith(settings.PUBLIC_BACKEND_URL))
        self.assertEqual(first.data["title"], "Forced Song")

        second = self.engine_get("/api/internal/force-play/")
        self.assertFalse(second.data["active"])  # claimed once — plays a single time

    def test_forced_track_waits_while_the_broadcast_is_off(self):
        from apps.common.models import StationSettings

        cfg = StationSettings.get()
        cfg.broadcast_enabled = False
        cfg.save()

        self.client.post(f"/api/admin-panel/tracks/{self.track.id}/play_now/")
        self.assertFalse(self.engine_get("/api/internal/force-play/").data["active"])

        cfg.broadcast_enabled = True
        cfg.save()
        self.assertTrue(self.engine_get("/api/internal/force-play/").data["active"])

    def test_play_now_rejects_a_disabled_track(self):
        from apps.broadcast.services import get_state

        self.track.enabled = False
        self.track.save(update_fields=["enabled"])
        resp = self.client.post(f"/api/admin-panel/tracks/{self.track.id}/play_now/")
        self.assertEqual(resp.status_code, 400)
        self.assertIsNone(get_state().force_track_id)

    def test_play_now_is_audited(self):
        self.client.post(f"/api/admin-panel/tracks/{self.track.id}/play_now/")
        from apps.common.models import AuditLog

        self.assertTrue(
            AuditLog.objects.filter(action="track.play_now", actor_email=self.admin.email).exists()
        )

    def test_listener_cannot_force_a_track(self):
        from apps.broadcast.services import get_state

        self.client.force_authenticate(self.listener)
        resp = self.client.post(f"/api/admin-panel/tracks/{self.track.id}/play_now/")
        self.assertEqual(resp.status_code, 403)
        self.assertIsNone(get_state().force_track_id)

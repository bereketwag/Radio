"""Admin "Play playlist now" / "Stop" — seasonal override of the rotation.

While a playlist override is active the engine m3u serves that playlist
instead of the default rotation; Stop clears it and the normal rotation
resumes. Validation keeps empty/disabled playlists off air.
"""
import io
import tempfile
import wave

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.broadcast.models import Playlist, Track

MEDIA = tempfile.mkdtemp(prefix="aurora-override-media-")


def wav_upload(name: str = "air.wav") -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * 8000)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class PlaylistOverrideTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@override.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.listener = User.objects.create_user(
            email="listener@override.test", username="listener", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)
        self.key = settings.BROADCAST_API_KEY
        self.library_track = Track.objects.create(
            title="Normal Song", artist="The Station", duration_seconds=3, audio_file=wav_upload("normal.wav")
        )
        self.xmas_track = Track.objects.create(
            title="Jingle Bells", artist="Sleigh", duration_seconds=3, audio_file=wav_upload("jingle.wav")
        )
        self.normal_playlist = Playlist.objects.create(name="Everyday", is_default=True, enabled=True)
        self.normal_playlist.entries.create(track=self.library_track, position=0)
        self.xmas = Playlist.objects.create(name="Christmas", enabled=True)
        self.xmas.entries.create(track=self.xmas_track, position=0)

    def engine_get(self, path: str):
        self.client.force_authenticate(user=None)
        return self.client.get(path, HTTP_X_BROADCAST_KEY=self.key)

    def play(self):
        return self.client.post(f"/api/admin-panel/playlists/{self.xmas.id}/play_now/")

    def stop(self):
        return self.client.post(f"/api/admin-panel/playlists/{self.xmas.id}/stop/")

    def test_play_now_puts_the_playlist_on_air_and_m3u_switches(self):
        resp = self.play()
        self.assertEqual(resp.status_code, 201, resp.data)

        body = self.engine_get("/api/internal/playlist.m3u").content.decode()
        self.assertIn("Sleigh - Jingle Bells", body)
        self.assertNotIn("The Station - Normal Song", body)  # override replaces the default

        self.client.force_authenticate(self.admin)
        data = self.client.get(f"/api/admin-panel/playlists/{self.xmas.id}/").data
        self.assertTrue(data["is_on_air"])
        default = self.client.get(f"/api/admin-panel/playlists/{self.normal_playlist.id}/").data
        self.assertFalse(default["is_on_air"])

    def test_stop_resumes_the_normal_rotation(self):
        self.play()
        self.stop()
        body = self.engine_get("/api/internal/playlist.m3u").content.decode()
        self.assertIn("The Station - Normal Song", body)
        self.assertNotIn("Jingle Bells", body)

        from apps.broadcast.services import get_state

        self.assertIsNone(get_state().override_playlist_id)

    def test_play_now_rejects_an_empty_playlist(self):
        empty = Playlist.objects.create(name="Empty Season", enabled=True)
        resp = self.client.post(f"/api/admin-panel/playlists/{empty.id}/play_now/")
        self.assertEqual(resp.status_code, 400)

        from apps.broadcast.services import get_state

        self.assertIsNone(get_state().override_playlist_id)

    def test_play_now_rejects_a_disabled_playlist(self):
        self.xmas.enabled = False
        self.xmas.save(update_fields=["enabled"])
        resp = self.play()
        self.assertEqual(resp.status_code, 400)

        from apps.broadcast.services import get_state

        self.assertIsNone(get_state().override_playlist_id)

    def test_stop_when_not_on_air_is_rejected(self):
        resp = self.stop()
        self.assertEqual(resp.status_code, 400)

    def test_play_now_is_audited(self):
        self.play()
        from apps.common.models import AuditLog

        self.assertTrue(AuditLog.objects.filter(action="playlist.play_now").exists())

    def test_listener_cannot_put_a_playlist_on_air(self):
        self.client.force_authenticate(self.listener)
        resp = self.play()
        self.assertEqual(resp.status_code, 403)

        from apps.broadcast.services import get_state

        self.assertIsNone(get_state().override_playlist_id)

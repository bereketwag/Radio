"""The complete listener-facing chain, walked end to end:

  admin uploads audio → it enters the default playlist → the engine's
  playlist.m3u serves an absolute URL for it → the engine reports it playing →
  the public website shows it live.

Every step goes through the real HTTP endpoints, not service calls, so a
contract break between the dashboard and the broadcast engine fails here.
"""
import io
import tempfile
import wave

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.broadcast.models import Playlist

MEDIA = tempfile.mkdtemp(prefix="aurora-air-media-")


def wav_upload(seconds: float = 1.5, rate: int = 8000) -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(b"\x80" * int(rate * seconds))
    return SimpleUploadedFile("air-time.wav", buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class UploadToAirTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@air.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.client.force_authenticate(self.admin)
        self.key = settings.BROADCAST_API_KEY

    def engine_get(self, path: str, **extra):
        return self.client.get(path, HTTP_X_BROADCAST_KEY=self.key, **extra)

    def engine_post(self, path: str, payload: dict, **extra):
        return self.client.post(path, payload, format="json", HTTP_X_BROADCAST_KEY=self.key, **extra)

    def test_track_uploaded_on_the_site_is_airable_on_the_stream(self):
        # 1. Dashboard upload — the API hands back a public URL + measured length.
        resp = self.client.post(
            "/api/admin-panel/tracks/",
            {"title": "Air Time", "artist": "The Vectors", "audio_file": wav_upload(1.5)},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        track_id = resp.data["id"]
        self.assertTrue(resp.data["audio_url"].startswith(settings.MEDIA_URL))
        self.assertGreater(resp.data["duration_seconds"], 0)
        self.assertTrue(resp.data["enabled"])  # straight into rotation

        # 2. The file really exists where that URL points (Django/nginx serves
        # MEDIA_URL in every deployment; storage is the source of truth here).
        from django.core.files.storage import default_storage

        self.assertTrue(resp.data["audio_url"].startswith(settings.MEDIA_URL))
        stored_path = resp.data["audio_url"][len(settings.MEDIA_URL):]
        self.assertTrue(default_storage.exists(stored_path))

        # 3. Admin builds the default rotation around it.
        self.client.force_authenticate(self.admin)
        playlist = self.client.post(
            "/api/admin-panel/playlists/",
            {"name": "Main rotation", "is_default": True, "enabled": True},
        )
        self.assertEqual(playlist.status_code, 201, playlist.data)
        added = self.client.post(
            f"/api/admin-panel/playlists/{playlist.data['id']}/add_track/", {"track_id": track_id}
        )
        self.assertEqual(added.status_code, 201, added.data)

        # 4. The engine fetches its playlist with the broadcast key.
        self.client.force_authenticate(user=None)
        m3u = self.engine_get("/api/internal/playlist.m3u")
        self.assertEqual(m3u.status_code, 200)
        body = m3u.content.decode()
        self.assertIn("#EXTINF:", body)
        self.assertIn("The Vectors - Air Time", body)
        # Absolute URL (the engine runs outside the web process).
        self.assertIn(settings.PUBLIC_BACKEND_URL, body)
        self.assertIn("air-time.wav", body)

        # 5. The engine reports the track starting + a heartbeat.
        started = timezone.now()
        self.assertEqual(
            self.engine_post(
                "/api/internal/heartbeat/", {"kind": "music", "engine_online": True}
            ).status_code,
            200,
        )
        self.assertEqual(
            self.engine_post(
                "/api/internal/ingest/",
                {"kind": "music", "title": "Air Time", "artist": "The Vectors",
                 "started_at": started.isoformat(), "duration_seconds": 2},
            ).status_code,
            200,
        )

        # 6. The public website now shows it live, with an honest position.
        now_playing = self.client.get("/api/broadcast/now-playing/")
        self.assertEqual(now_playing.status_code, 200)
        self.assertTrue(now_playing.data["live"])
        self.assertEqual(now_playing.data["title"], "Air Time")
        self.assertEqual(now_playing.data["artist"], "The Vectors")
        self.assertIsNotNone(now_playing.data["position_seconds"])

        # 7. And it lands in the "recently played" list.
        history = self.client.get("/api/broadcast/history/")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.data["results"][0]["title"], "Air Time")

    def test_engine_rejects_a_wrong_key(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get("/api/internal/playlist.m3u", HTTP_X_BROADCAST_KEY="nope").status_code,
            401,
        )

    def test_creating_a_default_playlist_clears_the_previous_default(self):
        first = self.client.post("/api/admin-panel/playlists/", {"name": "First", "is_default": True})
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post("/api/admin-panel/playlists/", {"name": "Second", "is_default": True})
        self.assertEqual(second.status_code, 201, second.data)
        self.assertFalse(Playlist.objects.get(pk=first.data["id"]).is_default)
        self.assertTrue(Playlist.objects.get(pk=second.data["id"]).is_default)

    def test_marking_a_playlist_as_fallback_demotes_it_from_default(self):
        created = self.client.post("/api/admin-panel/playlists/", {"name": "Solo", "is_default": True})
        self.assertEqual(created.status_code, 201, created.data)
        resp = self.client.patch(
            f"/api/admin-panel/playlists/{created.data['id']}/", {"is_fallback": True}
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        playlist = Playlist.objects.get(pk=created.data["id"])
        self.assertTrue(playlist.is_fallback)
        self.assertFalse(playlist.is_default)  # last explicit action wins

"""Waiting songs for the off-air state: upload like a mini music library.

Covers the chain the operator relies on: Settings uploads → off-air m3u for
the engine → loops while the broadcast is off → removals apply without a
restart. An empty collection must serve an empty m3u (engine plays silence).
"""
import io
import tempfile
import wave

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.broadcast.models import OffAirTrack

MEDIA = tempfile.mkdtemp(prefix="aurora-offair-media-")


def wav_upload(name: str = "waiting.wav") -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * 8000)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class OffAirTrackTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@offair.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.listener = User.objects.create_user(
            email="listener@offair.test", username="listener", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)
        self.key = settings.BROADCAST_API_KEY

    def engine_m3u(self):
        self.client.force_authenticate(user=None)
        return self.client.get("/api/internal/offair.m3u", HTTP_X_BROADCAST_KEY=self.key)

    def upload(self, title="Classical loop", name="waiting.wav"):
        return self.client.post(
            "/api/admin-panel/off-air-tracks/",
            {"title": title, "audio_file": wav_upload(name)},
            format="multipart",
        )

    def test_empty_collection_serves_an_empty_m3u(self):
        resp = self.engine_m3u()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content.decode(), "")

    def test_upload_appears_in_the_engine_m3u_in_order(self):
        first = self.upload("Morning classical", "one.wav")
        self.assertEqual(first.status_code, 201, first.data)
        second = self.upload("Evening piano", "two.wav")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertGreater(second.data["position"], first.data["position"])

        body = self.engine_m3u().content.decode()
        self.assertIn("Morning classical", body)
        self.assertIn("Evening piano", body)
        self.assertIn(settings.PUBLIC_BACKEND_URL, body)  # absolute URL for the engine
        # Upload order preserved.
        self.assertLess(body.index("Morning classical"), body.index("Evening piano"))

    def test_delete_removes_the_song_from_the_m3u(self):
        created = self.upload().data["id"]
        self.assertIn("waiting", self.engine_m3u().content.decode())
        self.client.force_authenticate(self.admin)  # engine_m3u() de-authenticated
        resp = self.client.delete(f"/api/admin-panel/off-air-tracks/{created}/")
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self.engine_m3u().content.decode(), "")

    def test_upload_rejects_non_audio_files(self):
        resp = self.client.post(
            "/api/admin-panel/off-air-tracks/",
            {"title": "Nope", "audio_file": SimpleUploadedFile("notes.txt", b"hi", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(OffAirTrack.objects.count(), 0)

    def test_offair_m3u_requires_the_broadcast_key(self):
        self.upload()
        self.client.force_authenticate(user=None)
        resp = self.client.get("/api/internal/offair.m3u")
        self.assertEqual(resp.status_code, 401)

    def test_listener_cannot_manage_waiting_songs(self):
        self.client.force_authenticate(self.listener)
        self.assertEqual(self.upload().status_code, 403)

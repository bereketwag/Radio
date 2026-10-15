"""CRUD coverage for the two admin surfaces the dashboard edits most:
the music library (sound upload) and the ad creative library/campaigns."""
import base64
import io
import tempfile
import wave

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.advertising.models import AdSchedule, Advertiser, AudioAdvert, AudioCampaign
from apps.broadcast.models import Track

MEDIA = tempfile.mkdtemp(prefix="aurora-test-media-")


def wav_bytes(seconds: float = 1.5, rate: int = 8000) -> bytes:
    """A tiny but valid PCM WAV so duration probing has something to measure."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(b"\x80" * int(rate * seconds))
    return buf.getvalue()


def audio_upload(name: str = "spot.wav", seconds: float = 1.5) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, wav_bytes(seconds), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class TrackCrudTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@crud.test", username="admin", password="x" * 12, role=Role.STATION_ADMIN
        )
        self.listener = User.objects.create_user(
            email="listener@crud.test", username="listener", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)

    def create_track(self, **overrides) -> Track:
        resp = self.client.post(
            "/api/admin-panel/tracks/",
            {"title": overrides.pop("title", "Original"), "audio_file": audio_upload(**overrides)},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return Track.objects.get(pk=resp.data["id"])

    def test_upload_probes_duration_and_returns_playable_url(self):
        resp = self.client.post(
            "/api/admin-panel/tracks/",
            {"title": "Long Play", "audio_file": audio_upload(seconds=1.5)},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["duration_seconds"], 2)  # 1.5s rounds up to 2
        self.assertTrue(resp.data["audio_url"].startswith("/media/"))
        # Regression: the form omits `enabled`, and multipart used to read the
        # missing checkbox as False — uploads must enter rotation by default.
        self.assertTrue(resp.data["enabled"])
        self.assertTrue(Track.objects.get(pk=resp.data["id"]).enabled)

    def test_upload_rejects_unknown_audio_extension(self):
        bad = SimpleUploadedFile("malware.exe", b"MZ", content_type="application/octet-stream")
        resp = self.client.post(
            "/api/admin-panel/tracks/", {"title": "Nope", "audio_file": bad}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported audio format", str(resp.data))

    def test_upload_rejects_oversized_audio(self):
        with override_settings(MAX_AUDIO_UPLOAD_MB=0):
            resp = self.client.post(
                "/api/admin-panel/tracks/", {"title": "Big", "audio_file": audio_upload()}, format="multipart"
            )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("the limit is 0 MB", str(resp.data))

    def test_upload_rejects_disallowed_image_extension(self):
        # Pillow accepts .bmp/.pdf/etc., but the station only serves
        # JPG/PNG/WebP — the station-level extension rule must reject them.
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        wrong_ext = SimpleUploadedFile("art.bmp", png, content_type="image/bmp")
        resp = self.client.post(
            "/api/admin-panel/tracks/",
            {"title": "Art", "audio_file": audio_upload(), "artwork": wrong_ext},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported image format", str(resp.data))

    def test_upload_rejects_corrupt_artwork(self):
        junk = SimpleUploadedFile("art.png", b"not an image", content_type="image/png")
        resp = self.client.post(
            "/api/admin-panel/tracks/",
            {"title": "Art", "audio_file": audio_upload(), "artwork": junk},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("artwork", resp.data)

    def test_update_metadata_keeps_existing_audio(self):
        track = self.create_track(title="Before")
        original_name = track.audio_file.name
        resp = self.client.patch(
            f"/api/admin-panel/tracks/{track.id}/",
            {"title": "After", "artist": "Someone"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        track.refresh_from_db()
        self.assertEqual(track.title, "After")
        self.assertEqual(track.audio_file.name, original_name)
        self.assertEqual(track.duration_seconds, 2)

    def test_update_with_new_audio_remeasures_duration(self):
        track = self.create_track(seconds=1.5)
        self.assertEqual(track.duration_seconds, 2)
        resp = self.client.patch(
            f"/api/admin-panel/tracks/{track.id}/",
            {"audio_file": audio_upload("replacement.wav", seconds=3.0)},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        track.refresh_from_db()
        self.assertEqual(track.duration_seconds, 3)
        self.assertTrue(track.audio_file.name.endswith("replacement.wav"))

    def test_territories_accept_plain_text_from_the_form(self):
        track = self.create_track()
        resp = self.client.patch(
            f"/api/admin-panel/tracks/{track.id}/",
            {"permitted_territories": "us, de"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["permitted_territories"], ["US", "DE"])
        self.assertEqual(resp.data["territories_display"], "US, DE")

    def test_territories_accept_json_list(self):
        track = self.create_track()
        resp = self.client.patch(
            f"/api/admin-panel/tracks/{track.id}/",
            {"permitted_territories": '["fr","NL"]'},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["permitted_territories"], ["FR", "NL"])

    def test_toggle_and_delete_round_trip(self):
        track = self.create_track()
        stored_name = track.audio_file.name
        self.assertTrue(default_storage.exists(stored_name))

        resp = self.client.post(f"/api/admin-panel/tracks/{track.id}/toggle_enabled/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["enabled"])

        resp = self.client.delete(f"/api/admin-panel/tracks/{track.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Track.objects.filter(pk=track.id).exists())
        # Deleting the row must free the uploaded file, not orphan it.
        self.assertFalse(default_storage.exists(stored_name))

    def test_listener_cannot_write_tracks(self):
        self.client.force_authenticate(self.listener)
        resp = self.client.post(
            "/api/admin-panel/tracks/", {"title": "Nope", "audio_file": audio_upload()}, format="multipart"
        )
        self.assertEqual(resp.status_code, 403)


@override_settings(MEDIA_ROOT=MEDIA)
class AdvertCrudTests(APITestCase):
    def setUp(self):
        self.ads = User.objects.create_user(
            email="ads@crud.test", username="ads", password="x" * 12, role=Role.AD_MANAGER
        )
        self.listener = User.objects.create_user(
            email="l@crud.test", username="l", password="x" * 12, role=Role.LISTENER
        )
        self.advertiser = Advertiser.objects.create(name="Northwind", email="n@example.com")
        self.client.force_authenticate(self.ads)

    def upload_advert(self, name="Spot", seconds=1.5) -> AudioAdvert:
        resp = self.client.post(
            "/api/admin-panel/audio-adverts/",
            {"name": name, "audio_file": audio_upload(f"{name}.wav", seconds=seconds), "approved": "true"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return AudioAdvert.objects.get(pk=resp.data["id"])

    def test_upload_advert_probes_duration_and_requires_audio(self):
        advert = self.upload_advert(seconds=1.5)
        self.assertEqual(advert.duration_seconds, 2)
        self.assertTrue(advert.approved)
        # Regression: an omitted `active` checkbox must not deactivate the spot.
        self.assertTrue(advert.active)

        resp = self.client.post(
            "/api/admin-panel/audio-adverts/", {"name": "Silent"}, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("audio_file", resp.data)

    def test_advert_update_and_delete(self):
        advert = self.upload_advert(name="Old name")
        stored_name = advert.audio_file.name
        resp = self.client.patch(
            f"/api/admin-panel/audio-adverts/{advert.id}/", {"name": "New name", "approved": "false"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        advert.refresh_from_db()
        self.assertEqual(advert.name, "New name")
        self.assertFalse(advert.approved)
        # An edit without a new file keeps the stored audio.
        self.assertEqual(advert.audio_file.name, stored_name)

        resp = self.client.delete(f"/api/admin-panel/audio-adverts/{advert.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AudioAdvert.objects.filter(pk=advert.id).exists())
        self.assertFalse(default_storage.exists(stored_name))

    def test_campaign_attaches_and_detaches_adverts(self):
        a1 = self.upload_advert("One")
        a2 = self.upload_advert("Two")
        resp = self.client.post(
            "/api/admin-panel/audio-campaigns/",
            {"advertiser": str(self.advertiser.id), "name": "Spring", "priority": 7},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        campaign_id = resp.data["id"]

        resp = self.client.patch(
            f"/api/admin-panel/audio-campaigns/{campaign_id}/", {"advert_ids": [str(a1.id)]}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual([a["id"] for a in resp.data["adverts"]], [str(a1.id)])

        resp = self.client.patch(
            f"/api/admin-panel/audio-campaigns/{campaign_id}/", {"advert_ids": [str(a2.id)]}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        campaign = AudioCampaign.objects.get(pk=campaign_id)
        self.assertEqual(list(campaign.adverts.all()), [a2])

        resp = self.client.patch(
            f"/api/admin-panel/audio-campaigns/{campaign_id}/", {"advert_ids": []}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(campaign.adverts.count(), 0)

    def test_campaign_update_and_delete(self):
        resp = self.client.post(
            "/api/admin-panel/audio-campaigns/",
            {"advertiser": str(self.advertiser.id), "name": "Temp"},
            format="json",
        )
        campaign_id = resp.data["id"]

        resp = self.client.patch(
            f"/api/admin-panel/audio-campaigns/{campaign_id}/", {"name": "Renamed", "priority": 3},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["name"], "Renamed")

        resp = self.client.delete(f"/api/admin-panel/audio-campaigns/{campaign_id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AudioCampaign.objects.filter(pk=campaign_id).exists())

    def test_schedule_create_update_delete(self):
        campaign = AudioCampaign.objects.create(advertiser=self.advertiser, name="Sched")
        resp = self.client.post(
            f"/api/admin-panel/audio-campaigns/{campaign.id}/schedules/",
            {"recurrence": "daily", "local_time": "12:30", "starts_at": "2026-01-01T00:00:00Z",
             "max_break_seconds": 45},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        schedule_id = resp.data["schedule"]["id"]

        resp = self.client.patch(
            f"/api/admin-panel/ad-schedules/{schedule_id}/", {"max_break_seconds": 90}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["max_break_seconds"], 90)

        schedule = AdSchedule.objects.get(pk=schedule_id)
        resp = self.client.post(f"/api/admin-panel/ad-schedules/{schedule_id}/disable/")
        self.assertEqual(resp.status_code, 200)
        schedule.refresh_from_db()
        self.assertFalse(schedule.enabled)

        resp = self.client.delete(f"/api/admin-panel/ad-schedules/{schedule_id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AdSchedule.objects.filter(pk=schedule_id).exists())

    def test_listener_cannot_write_ad_creative(self):
        self.client.force_authenticate(self.listener)
        resp = self.client.post(
            "/api/admin-panel/audio-adverts/", {"name": "Nope"}, format="multipart"
        )
        self.assertEqual(resp.status_code, 403)

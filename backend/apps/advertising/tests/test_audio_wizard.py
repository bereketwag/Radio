"""The one-request wizard that creates a complete, airing audio campaign."""
import io
import tempfile
import wave
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.advertising import services
from apps.advertising.models import (
    AdBreakLog,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    PaymentStatus,
)
from apps.broadcast.models import BroadcastState
from apps.broadcast.services import build_force_play_payload, build_status_payload
from apps.common.models import StationSettings

MEDIA = tempfile.mkdtemp(prefix="aurora-wizard-media-")


def audio_upload(name: str = "spot.wav", seconds: float = 1.5) -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * int(8000 * seconds))
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


@override_settings(MEDIA_ROOT=MEDIA)
class AudioCampaignWizardTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@wizard.test", username="wizard", password="x" * 12, role=Role.STATION_ADMIN
        )
        self.client.force_authenticate(self.admin)

    def quick_start(self, **overrides):
        payload = {
            "advert_name": "Sunday invite",
            "audio_file": audio_upload(),
            "advertiser_name": "Grace Chapel",
            "campaign_name": "Sunday invite — daily",
            "recurrence": "daily",
            "times": "12:00,18:00",
        }
        payload.update(overrides)
        return self.client.post(
            "/api/admin-panel/audio-campaigns/quick-start/", payload, format="multipart"
        )

    def test_wizard_creates_a_campaign_that_can_air(self):
        resp = self.quick_start()
        self.assertEqual(resp.status_code, 201, resp.data)
        campaign = AudioCampaign.objects.get(pk=resp.data["campaign"]["id"])

        self.assertEqual(campaign.status, CampaignStatus.ACTIVE)
        self.assertEqual(campaign.payment_status, PaymentStatus.PAID)
        self.assertTrue(campaign.adverts.filter(approved=True, active=True).exists())
        self.assertEqual(campaign.schedules.count(), 2)
        # New advertiser is saved for next time, without a separate setup step.
        self.assertTrue(Advertiser.objects.filter(name="Grace Chapel").exists())

        self.assertTrue(resp.data["campaign"]["readiness"]["ready"])
        self.assertIsNotNone(resp.data["campaign"]["next_break_at"])
        self.assertTrue(campaign.is_eligible())

    def test_wizard_weekdays_creates_one_schedule_per_day(self):
        resp = self.quick_start(recurrence="weekdays", times="09:30")
        self.assertEqual(resp.status_code, 201, resp.data)
        campaign = AudioCampaign.objects.get(pk=resp.data["campaign"]["id"])
        self.assertEqual(campaign.schedules.count(), 5)
        self.assertEqual(
            sorted(campaign.schedules.values_list("weekday", flat=True)), [0, 1, 2, 3, 4]
        )

    def test_wizard_needs_an_audio_file(self):
        payload = {
            "advert_name": "No file",
            "advertiser_name": "Grace Chapel",
            "recurrence": "daily",
            "times": "12:00",
        }
        resp = self.client.post(
            "/api/admin-panel/audio-campaigns/quick-start/", payload, format="multipart"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("audio_file", resp.data)
        self.assertFalse(AudioCampaign.objects.exists())

    def test_one_click_start_clears_every_hidden_gate(self):
        advertiser = Advertiser.objects.create(name="Paused Co", email="p@example.com")
        campaign = AudioCampaign.objects.create(
            advertiser=advertiser,
            name="Paused campaign",
            status=CampaignStatus.PAUSED,
            payment_status=PaymentStatus.UNPAID,
            priority=5,
        )
        spot = AudioAdvert.objects.create(name="Old spot", duration_seconds=20, approved=False)
        campaign.adverts.add(spot)
        AdSchedule.objects.create(
            campaign=campaign,
            recurrence=AdSchedule.Recurrence.DAILY,
            starts_at=timezone.now() - timedelta(days=1),
            local_time=timezone.now().time().replace(microsecond=0),
            max_break_seconds=60,
        )

        resp = self.client.post(f"/api/admin-panel/audio-campaigns/{campaign.id}/start/")
        self.assertEqual(resp.status_code, 200, resp.data)

        campaign.refresh_from_db()
        spot.refresh_from_db()
        self.assertEqual(campaign.status, CampaignStatus.ACTIVE)
        self.assertEqual(campaign.payment_status, PaymentStatus.PAID)
        self.assertTrue(spot.approved and spot.active)
        self.assertTrue(resp.data["readiness"]["ready"])

    def test_start_refuses_a_campaign_without_a_schedule(self):
        advertiser = Advertiser.objects.create(name="No Times", email="n@example.com")
        campaign = AudioCampaign.objects.create(
            advertiser=advertiser, name="No times", status=CampaignStatus.DRAFT
        )
        campaign.adverts.add(AudioAdvert.objects.create(name="Spot", duration_seconds=20, approved=True))
        resp = self.client.post(f"/api/admin-panel/audio-campaigns/{campaign.id}/start/")
        self.assertEqual(resp.status_code, 400)

    def test_play_now_sends_the_spot_to_the_engine_immediately(self):
        resp = self.quick_start()
        campaign_id = resp.data["campaign"]["id"]
        play = self.client.post(f"/api/admin-panel/audio-campaigns/{campaign_id}/play_now/")
        self.assertEqual(play.status_code, 200, play.data)

        state = BroadcastState.objects.get(pk=1)
        self.assertEqual(state.force_kind, "advert")
        self.assertTrue(state.force_audio_url)
        self.assertTrue(state.force_title)
        self.assertTrue(state.force_ref_id)

        # The engine's next poll receives a normal force-play payload that is
        # marked as an advertisement, so the website can say "ADVERT".
        payload = build_force_play_payload()
        self.assertTrue(payload["active"])
        self.assertEqual(payload["kind"], "advert")
        self.assertEqual(payload["uri"], state.force_audio_url)

        # The manual play is already in the break history.
        log = AdBreakLog.objects.get(pk=state.force_ref_id)
        self.assertEqual(log.result, AdBreakLog.Result.PLAYED)
        self.assertEqual(str(log.campaign_id), campaign_id)

    def test_play_now_refuses_while_the_station_is_off(self):
        resp = self.quick_start()
        campaign_id = resp.data["campaign"]["id"]
        settings_row = StationSettings.get()
        settings_row.broadcast_enabled = False
        settings_row.save(update_fields=["broadcast_enabled"])

        play = self.client.post(f"/api/admin-panel/audio-campaigns/{campaign_id}/play_now/")
        self.assertEqual(play.status_code, 400)
        self.assertIn("switched off", play.data["detail"])

    def test_engine_length_does_not_inflate_the_break(self):
        """A reported 28s must not turn a 15s spot into a 28s break."""
        advertiser = Advertiser.objects.create(name="Length Co", email="l@example.com")
        campaign = AudioCampaign.objects.create(
            advertiser=advertiser,
            name="Length campaign",
            status=CampaignStatus.ACTIVE,
            payment_status=PaymentStatus.PAID,
            starts_at=timezone.now() - timedelta(days=1),
        )
        spot = AudioAdvert.objects.create(name="Short spot", duration_seconds=15, approved=True, active=True)
        campaign.adverts.add(spot)

        services.record_ad_played({"advert_id": str(spot.id), "duration": 28})
        log = AdBreakLog.objects.get(campaign=campaign)
        self.assertEqual(log.seconds_played, 15)

        # And now-playing reports the advert, with its real length.
        status = build_status_payload()
        self.assertEqual(status["kind"], "advert")
        self.assertEqual(status["title"], "Short spot")
        self.assertEqual(status["artist"], "Length Co")
        self.assertEqual(status["duration_seconds"], 15)

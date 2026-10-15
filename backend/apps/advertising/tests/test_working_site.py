"""End-to-end flows the working site depends on.

Each test mirrors a real user path: an advertiser submits the public form,
the station reviews it, turns it into a campaign, schedules audio breaks, and
the engine picks them up. These lock in the regressions that broke the site.
"""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.advertising import services
from apps.advertising.models import (
    AdRequest,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    CampaignStatus,
    PaymentStatus,
)


def make_advertiser(**overrides) -> Advertiser:
    defaults = dict(name="Acme", email="bill@acme.test")
    defaults.update(overrides)
    return Advertiser.objects.create(**defaults)


def make_campaign(**overrides) -> AudioCampaign:
    advertiser = overrides.pop("advertiser", None) or make_advertiser()
    defaults = dict(
        advertiser=advertiser,
        name="Acme spots",
        status=CampaignStatus.ACTIVE,
        payment_status=PaymentStatus.PAID,
    )
    defaults.update(overrides)
    return AudioCampaign.objects.create(**defaults)


class AdRequestMineTests(APITestCase):
    """GET /api/ads/requests/mine/ used to raise NameError (AdRequest not
    imported) → HTTP 500 on the account page, silently swallowed by the SPA."""

    def test_returns_the_users_own_submissions(self):
        user = User.objects.create_user(
            email="me@site.test", username="me", password="x" * 12, role=Role.LISTENER
        )
        AdRequest.objects.create(
            business_name="Mine", contact_name="Me", email=user.email, ad_format="banner"
        )
        AdRequest.objects.create(
            business_name="Not mine", contact_name="Other", email="other@site.test", ad_format="audio"
        )
        self.client.force_authenticate(user)
        resp = self.client.get("/api/ads/requests/mine/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["business_name"], "Mine")

    def test_requires_auth(self):
        self.assertEqual(self.client.get("/api/ads/requests/mine/").status_code, 401)


class AdRequestThrottleTests(APITestCase):
    """The ad-request throttle was dead code (never enforced) — a spam vector."""

    def setUp(self):
        cache.clear()

    def test_sixth_request_in_an_hour_is_rate_limited(self):
        payload = {
            "business_name": "Spam", "contact_name": "Bot", "email": "bot@spam.test",
            "ad_format": "banner",
        }
        for i in range(5):
            resp = self.client.post("/api/ads/requests/", payload)
            self.assertEqual(resp.status_code, 201, f"request {i + 1} should pass")
        resp = self.client.post("/api/ads/requests/", payload)
        self.assertEqual(resp.status_code, 429)


class ApprovedRequestBecomesCampaignTests(APITestCase):
    """Reviewing a request, then creating the campaign it links to."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="ads@station.test", username="ads", password="x" * 12, role=Role.AD_MANAGER
        )
        self.client.force_authenticate(self.admin)
        self.request = AdRequest.objects.create(
            business_name="Blue Cafe",
            contact_name="Alex",
            email="alex@blue.test",
            ad_format="banner",
            start_date=None,
            end_date=None,
        )

    def approve(self):
        return self.client.post(
            f"/api/admin-panel/ad-requests/{self.request.id}/decide/", {"decision": "approved"}
        )

    def test_approve_marks_the_request(self):
        resp = self.approve()
        self.assertEqual(resp.status_code, 200)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "approved")
        self.assertEqual(self.request.handled_by, self.admin)

    def test_creating_a_campaign_from_the_request_links_back(self):
        self.approve()
        advertiser = self.client.post(
            "/api/admin-panel/advertisers/",
            {"name": self.request.business_name, "email": self.request.email},
        )
        self.assertEqual(advertiser.status_code, 201, advertiser.data)

        campaign = self.client.post(
            "/api/admin-panel/visual-campaigns/",
            {
                "advertiser": advertiser.data["id"],
                "name": self.request.business_name,
                "request": self.request.id,
                "placement": "sidebar",
                "destination_url": "https://blue.test",
            },
            format="multipart",
        )
        self.assertEqual(campaign.status_code, 201, campaign.data)
        self.assertEqual(str(campaign.data["request"]), str(self.request.id))

    def test_banner_campaign_without_creative_does_not_serve(self):
        """The request→campaign shell has no banner yet; it must not rotate."""
        advertiser = make_advertiser()
        campaign = self.client.post(
            "/api/admin-panel/visual-campaigns/",
            {
                "advertiser": advertiser.id, "name": "Shell", "placement": "sidebar",
                "destination_url": "https://x.test",
            },
            format="multipart",
        )
        self.assertEqual(campaign.status_code, 201, campaign.data)
        self.assertFalse(campaign.data["eligible"])
        # Public rotation never sees a creative-less campaign.
        public = self.client.get("/api/ads/banners/?placement=sidebar")
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data["count"], 0)
        # Approving + paying still does not serve it without a creative.
        self.client.post(
            f"/api/admin-panel/visual-campaigns/{campaign.data['id']}/set_status/", {"status": "approved"}
        )
        self.client.post(
            f"/api/admin-panel/visual-campaigns/{campaign.data['id']}/set_payment/", {"payment_status": "paid"}
        )
        self.assertEqual(self.client.get("/api/ads/banners/?placement=sidebar").data["count"], 0)


class AudioAdBreakFlowTests(TestCase):
    """Upload a spot, schedule a break, and confirm the engine receives it."""

    def test_scheduled_break_delivers_the_advert_queue(self):
        now = timezone.now()
        campaign = make_campaign()
        spot = AudioAdvert(name="Acme 10s", approved=True, active=True, duration_seconds=10)
        spot.audio_file.name = "ads/audio/acme.mp3"
        spot.save()
        campaign.adverts.add(spot)

        AdSchedule.objects.create(
            campaign=campaign,
            recurrence=AdSchedule.Recurrence.ONCE,
            starts_at=now - timedelta(seconds=10),
            max_break_seconds=60,
        )

        payload = services.build_ad_break_payload(at=now)
        self.assertTrue(payload["active"])
        self.assertEqual(len(payload["adverts"]), 1)
        self.assertEqual(payload["adverts"][0]["name"], "Acme 10s")
        self.assertTrue(payload["adverts"][0]["uri"])  # the engine needs a URI
        self.assertEqual(payload["adverts"][0]["duration"], 10)

    def test_break_is_not_served_twice_in_the_same_window(self):
        now = timezone.now()
        campaign = make_campaign()
        spot = AudioAdvert(name="Acme", approved=True, active=True, duration_seconds=10)
        spot.audio_file.name = "ads/audio/acme.mp3"
        spot.save()
        campaign.adverts.add(spot)
        schedule = AdSchedule.objects.create(
            campaign=campaign,
            recurrence=AdSchedule.Recurrence.ONCE,
            starts_at=now - timedelta(seconds=10),
            max_break_seconds=60,
        )

        first = services.build_ad_break_payload(at=now)
        self.assertTrue(first["active"])

        # Engine confirms it played.
        services.record_ad_played({
            "advert_id": str(spot.id),
            "schedule_id": str(schedule.id),
            "filename": "acme.mp3",
            "duration": 10,
            "played_at": now.isoformat(),
        })

        second = services.build_ad_break_payload(at=now + timedelta(seconds=30))
        self.assertFalse(second["active"])

    def test_unapproved_or_unpaid_campaign_never_inserts_a_break(self):
        now = timezone.now()
        campaign = make_campaign(payment_status=PaymentStatus.UNPAID)
        spot = AudioAdvert(name="Acme", approved=True, active=True, duration_seconds=10)
        spot.audio_file.name = "ads/audio/acme.mp3"
        spot.save()
        campaign.adverts.add(spot)
        AdSchedule.objects.create(
            campaign=campaign,
            recurrence=AdSchedule.Recurrence.ONCE,
            starts_at=now - timedelta(seconds=10),
            max_break_seconds=60,
        )
        payload = services.build_ad_break_payload(at=now)
        self.assertFalse(payload["active"])
        self.assertEqual(payload["adverts"], [])

    def test_unapproved_spot_is_excluded_from_the_queue(self):
        now = timezone.now()
        campaign = make_campaign()
        approved = AudioAdvert(name="Approved", approved=True, active=True, duration_seconds=10)
        pending = AudioAdvert(name="Pending", approved=False, active=True, duration_seconds=10)
        for advert in (approved, pending):
            advert.audio_file.name = f"ads/audio/{advert.name.lower()}.mp3"
            advert.save()
        campaign.adverts.add(approved, pending)
        AdSchedule.objects.create(
            campaign=campaign,
            recurrence=AdSchedule.Recurrence.ONCE,
            starts_at=now - timedelta(seconds=10),
            max_break_seconds=60,
        )
        payload = services.build_ad_break_payload(at=now)
        names = [a["name"] for a in payload["adverts"]]
        self.assertEqual(names, ["Approved"])

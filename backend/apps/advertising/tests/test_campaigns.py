"""Business rule tests: campaign eligibility, expired ad exclusion."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.advertising import services
from apps.advertising.models import (
    Advertiser,
    CampaignStatus,
    PaymentStatus,
    VisualCampaign,
)


def make_campaign(**overrides) -> VisualCampaign:
    advertiser, _ = Advertiser.objects.get_or_create(
        name="Test Co", defaults={"email": "test@example.com"}
    )
    defaults = dict(
        advertiser=advertiser,
        name="Test Banner",
        # A stored-name assignment (no disk I/O): a campaign with no creative
        # is a draft that never serves, so eligibility fixtures need one.
        banner_image="banners/test.png",
        destination_url="https://example.com",
        status=CampaignStatus.APPROVED,
        payment_status=PaymentStatus.PAID,
        starts_at=None,
        ends_at=None,
    )
    defaults.update(overrides)
    return VisualCampaign.objects.create(**defaults)


class VisualEligibilityTests(TestCase):
    def test_approved_paid_campaign_is_eligible(self):
        c = make_campaign()
        self.assertTrue(c.is_eligible())
        self.assertIn(c, services.eligible_visual_campaigns())

    def test_draft_campaign_never_eligible(self):
        c = make_campaign(status=CampaignStatus.DRAFT)
        self.assertFalse(c.is_eligible())
        self.assertNotIn(c, services.eligible_visual_campaigns())

    def test_pending_campaign_never_eligible(self):
        c = make_campaign(status=CampaignStatus.PENDING)
        self.assertFalse(c.is_eligible())

    def test_rejected_campaign_never_eligible(self):
        c = make_campaign(status=CampaignStatus.REJECTED)
        self.assertFalse(c.is_eligible())

    def test_unpaid_campaign_never_eligible(self):
        c = make_campaign(payment_status=PaymentStatus.UNPAID)
        self.assertFalse(c.is_eligible())

    def test_paused_campaign_never_eligible(self):
        c = make_campaign(status=CampaignStatus.PAUSED)
        self.assertFalse(c.is_eligible())

    def test_expired_campaign_excluded(self):
        now = timezone.now()
        c = make_campaign(starts_at=now - timedelta(days=10), ends_at=now - timedelta(days=1))
        self.assertFalse(c.is_eligible(at=now))
        self.assertNotIn(c, services.eligible_visual_campaigns(at=now))

    def test_future_campaign_not_yet_eligible(self):
        now = timezone.now()
        c = make_campaign(starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=30))
        self.assertFalse(c.is_eligible(at=now))

    def test_campaign_inside_window_eligible(self):
        now = timezone.now()
        c = make_campaign(starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1))
        self.assertTrue(c.is_eligible(at=now))

    def test_campaign_without_creative_never_serves(self):
        """A shell created from an approved request has no banner yet — it must
        never rotate until the creative is uploaded."""
        c = make_campaign(banner_image="")
        self.assertFalse(c.is_eligible())
        self.assertNotIn(c, services.eligible_visual_campaigns())

    def test_placement_filter(self):
        sidebar = make_campaign(placement="sidebar")
        below = make_campaign(name="Below", placement="below_player")
        result = services.eligible_visual_campaigns(placement="sidebar")
        self.assertIn(sidebar, result)
        self.assertNotIn(below, result)

    def test_rotation_prefers_higher_priority(self):
        low = make_campaign(name="Low", priority=1)
        high = make_campaign(name="High", priority=10)
        ordered = services.rotation_order([low, high])
        self.assertEqual(ordered[0], high)

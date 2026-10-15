"""Business rule tests: role permissions on administrative endpoints."""
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.advertising.models import Advertiser, CampaignStatus, VisualCampaign


def make_user(role: str, email: str) -> User:
    return User.objects.create_user(
        username=email.split("@")[0], email=email, password="test-password-123", role=role
    )


class RolePermissionTests(APITestCase):
    def setUp(self):
        self.admin = make_user(Role.SUPER_ADMIN, "admin@test.dev")
        self.station = make_user(Role.STATION_ADMIN, "station@test.dev")
        self.ad_manager = make_user(Role.AD_MANAGER, "ads@test.dev")
        self.advertiser = make_user(Role.ADVERTISER, "adv@test.dev")
        self.listener = make_user(Role.LISTENER, "listener@test.dev")

    def login(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_anonymous_cannot_list_ad_requests(self):
        resp = self.client.get("/api/admin-panel/ad-requests/")
        self.assertIn(resp.status_code, (401, 403))

    def test_listener_cannot_list_ad_requests(self):
        self.login(self.listener)
        resp = self.client.get("/api/admin-panel/ad-requests/")
        self.assertEqual(resp.status_code, 403)

    def test_advertiser_cannot_list_ad_requests(self):
        self.login(self.advertiser)
        resp = self.client.get("/api/admin-panel/ad-requests/")
        self.assertEqual(resp.status_code, 403)

    def test_ad_manager_can_list_ad_requests(self):
        self.login(self.ad_manager)
        resp = self.client.get("/api/admin-panel/ad-requests/")
        self.assertEqual(resp.status_code, 200)

    def test_station_admin_can_list_ad_requests(self):
        self.login(self.station)
        resp = self.client.get("/api/admin-panel/ad-requests/")
        self.assertEqual(resp.status_code, 200)

    def test_ad_manager_cannot_manage_users(self):
        self.login(self.ad_manager)
        resp = self.client.get("/api/admin-panel/users/")
        self.assertEqual(resp.status_code, 403)

    def test_super_admin_can_manage_users(self):
        self.login(self.admin)
        resp = self.client.get("/api/admin-panel/users/")
        self.assertEqual(resp.status_code, 200)

    def test_ad_manager_cannot_upload_tracks(self):
        self.login(self.ad_manager)
        resp = self.client.post("/api/admin-panel/tracks/", {}, format="multipart")
        self.assertEqual(resp.status_code, 403)

    def test_station_admin_can_manage_tracks(self):
        self.login(self.station)
        resp = self.client.get("/api/admin-panel/tracks/")
        self.assertEqual(resp.status_code, 200)

    def test_listener_cannot_change_role(self):
        self.login(self.listener)
        resp = self.client.post(f"/api/admin-panel/users/{self.listener.id}/change-role/", {"role": Role.SUPER_ADMIN})
        self.assertEqual(resp.status_code, 403)

    def test_only_super_admin_changes_roles(self):
        self.login(self.admin)
        resp = self.client.post(
            f"/api/admin-panel/users/{self.listener.id}/change-role/", {"role": Role.AD_MANAGER}
        )
        self.assertEqual(resp.status_code, 200)
        self.listener.refresh_from_db()
        self.assertEqual(self.listener.role, Role.AD_MANAGER)

    def test_super_admin_can_create_user(self):
        self.login(self.admin)
        resp = self.client.post(
            "/api/admin-panel/users/",
            {
                "email": "new.admin@test.dev",
                "password": "super-secret-pass-123",
                "display_name": "New Admin",
                "role": Role.STATION_ADMIN,
            },
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["role"], Role.STATION_ADMIN)
        self.assertEqual(resp.data["email"], "new.admin@test.dev")

    def test_cannot_change_own_role(self):
        self.login(self.admin)
        resp = self.client.post(
            f"/api/admin-panel/users/{self.admin.id}/change-role/", {"role": Role.LISTENER}
        )
        self.assertEqual(resp.status_code, 400)

    def test_registration_cannot_self_assign_admin_role(self):
        resp = self.client.post(
            "/api/auth/register/",
            {
                "email": "evil@test.dev",
                "username": "evil",
                "password": "super-secret-pass-123",
                "password_confirm": "super-secret-pass-123",
                "role": Role.SUPER_ADMIN,
            },
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["user"]["role"], Role.LISTENER)


class InternalEndpointAuthTests(APITestCase):
    def test_ingest_rejects_bad_key(self):
        resp = self.client.post("/api/internal/ingest/", {}, HTTP_X_BROADCAST_KEY="wrong")
        self.assertEqual(resp.status_code, 401)

    def test_playlist_rejects_bad_key(self):
        resp = self.client.get("/api/internal/playlist.m3u", HTTP_X_BROADCAST_KEY="wrong")
        self.assertEqual(resp.status_code, 401)


class AdRequestFlowTests(APITestCase):
    def setUp(self):
        # The public form is rate-limited per IP; without this the limit leaks
        # across tests in the same process.
        from django.core.cache import cache

        cache.clear()

    def submit(self, **overrides):
        payload = {
            "business_name": "Blue Cafe",
            "contact_name": "Alex",
            "email": "alex@blue.test",
            "ad_format": "banner",
        }
        payload.update(overrides)
        return self.client.post("/api/ads/requests/", payload)

    def test_request_stored_as_pending(self):
        resp = self.submit()
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["status"], "pending")
        from apps.advertising.models import AdRequest

        self.assertEqual(AdRequest.objects.get().status, "pending")

    def test_end_date_before_start_rejected(self):
        from datetime import date

        resp = self.submit(start_date=date(2026, 5, 1), end_date=date(2026, 4, 1))
        self.assertEqual(resp.status_code, 400)

    def test_missing_required_fields_rejected(self):
        resp = self.client.post("/api/ads/requests/", {"business_name": "X"})
        self.assertEqual(resp.status_code, 400)

    def test_blank_optional_fields_from_the_browser_form_are_accepted(self):
        """The SPA sends "" for untouched optional fields, including the two
        'optional' dates. DRF's DateField rejects "" outright, so the public
        form used to 400 on every submission that skipped the dates."""
        resp = self.submit(
            start_date="", end_date="", phone="", website="",
            target_audience="", estimated_budget="", message="",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        from apps.advertising.models import AdRequest

        row = AdRequest.objects.get()
        self.assertIsNone(row.start_date)
        self.assertIsNone(row.end_date)

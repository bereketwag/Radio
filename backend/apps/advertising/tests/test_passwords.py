"""Password flows: super-admin reset, self change-password, overview keys.

- Super admin can reset any user's forgotten password to a temporary one
  (no email needed); the old password dies and existing sessions are killed.
- A signed-in user can change their own password with the current one.
- The overview carries the new playlist-override and 7-day ad stats.
"""
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User


class PasswordFlowsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="boss@station.test", username="boss", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.listener = User.objects.create_user(
            email="lost@station.test", username="lost", password="old-password-1", role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)

    def test_super_admin_resets_a_forgotten_password(self):
        resp = self.client.post(f"/api/admin-panel/users/{self.listener.id}/reset-password/")
        self.assertEqual(resp.status_code, 200, resp.data)
        temp = resp.data["temporary_password"]
        self.assertTrue(temp)

        # Old password is dead; the temporary one now works.
        self.listener.refresh_from_db()
        self.assertFalse(self.listener.check_password("old-password-1"))
        self.assertTrue(self.listener.check_password(temp))

    def test_reset_password_invalidates_existing_sessions(self):
        from rest_framework.authtoken.models import Token

        token = Token.objects.create(user=self.listener)
        self.client.post(f"/api/admin-panel/users/{self.listener.id}/reset-password/")
        self.assertFalse(Token.objects.filter(key=token.key).exists())

    def test_only_super_admin_can_reset_passwords(self):
        from apps.accounts.models import Role as R

        station_admin = User.objects.create_user(
            email="sa@station.test", username="sa", password="x" * 12, role=R.STATION_ADMIN
        )
        self.client.force_authenticate(station_admin)
        resp = self.client.post(f"/api/admin-panel/users/{self.listener.id}/reset-password/")
        self.assertEqual(resp.status_code, 403)

    def test_change_password_requires_the_current_one(self):
        self.client.force_authenticate(self.listener)
        resp = self.client.post(
            "/api/auth/change-password/",
            {"current_password": "wrong", "new_password": "brand-new-pass-99"},
        )
        self.assertEqual(resp.status_code, 400)
        self.listener.refresh_from_db()
        self.assertTrue(self.listener.check_password("old-password-1"))

    def test_change_password_round_trip(self):
        self.client.force_authenticate(self.listener)
        resp = self.client.post(
            "/api/auth/change-password/",
            {"current_password": "old-password-1", "new_password": "brand-new-pass-99"},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.listener.refresh_from_db()
        self.assertTrue(self.listener.check_password("brand-new-pass-99"))

    def test_change_password_requires_auth(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(
            "/api/auth/change-password/",
            {"current_password": "x", "new_password": "y" * 12},
        )
        self.assertEqual(resp.status_code, 401)

    def test_overview_carries_override_and_ad_performance(self):
        resp = self.client.get("/api/admin-panel/overview/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("playlist_override", resp.data)
        self.assertFalse(resp.data["playlist_override"]["active"])
        self.assertIn("ad_performance_7d", resp.data)
        self.assertIn("impressions", resp.data["ad_performance_7d"])
        self.assertIn("clicks", resp.data["ad_performance_7d"])

"""Station settings (theme colour + branding) and the init_station bootstrap."""
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.advertising.models import Advertiser, AudioCampaign
from apps.broadcast.models import Playlist, Track
from apps.common.models import StationSettings


class StationSettingsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@settings.test", username="admin", password="x" * 12, role=Role.SUPER_ADMIN
        )
        self.listener = User.objects.create_user(
            email="listener@settings.test", username="listener", password="x" * 12, role=Role.LISTENER
        )
        self.client.force_authenticate(self.admin)

    def test_get_returns_defaults_before_any_edit(self):
        resp = self.client.get("/api/admin-panel/station-settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["accent_color"], "#169154")

    def test_public_station_config_exposes_accent_color(self):
        cfg = StationSettings.get()
        cfg.accent_color = "#3366ff"
        cfg.save()
        resp = self.client.get("/api/station/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["accent_color"], "#3366ff")
        # Never leaks the internal demo flag or anything non-public.
        self.assertNotIn("demo_mode", resp.data)

    def test_public_config_falls_back_to_env_when_fields_blank(self):
        cfg = StationSettings.get()
        cfg.name = ""
        cfg.accent_color = "#3366ff"
        cfg.save()
        resp = self.client.get("/api/station/")
        from django.conf import settings

        self.assertEqual(resp.data["name"], settings.STATION_NAME)

    def test_patch_updates_accent_color_and_branding(self):
        resp = self.client.patch(
            "/api/admin-panel/station-settings/",
            {"accent_color": "#ff6600", "name": "My Station", "contact_email": "hi@my.fm"},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["accent_color"], "#ff6600")
        cfg = StationSettings.get()
        self.assertEqual(cfg.name, "My Station")
        self.assertEqual(cfg.contact_email, "hi@my.fm")
        self.assertEqual(cfg.accent_color, "#ff6600")

    def test_patch_rejects_invalid_hex_color(self):
        resp = self.client.patch("/api/admin-panel/station-settings/", {"accent_color": "green"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("accent_color", str(resp.data))
        self.assertEqual(StationSettings.get().accent_color, "#169154")

    def test_patch_is_audited(self):
        from apps.common.models import AuditLog

        self.client.patch("/api/admin-panel/station-settings/", {"accent_color": "#ff6600"})
        self.assertTrue(
            AuditLog.objects.filter(action="station_settings.update", actor_email=self.admin.email).exists()
        )

    def test_staff_without_station_role_is_forbidden(self):
        self.client.force_authenticate(self.listener)
        self.assertEqual(self.client.get("/api/admin-panel/station-settings/").status_code, 403)
        self.assertEqual(
            self.client.patch("/api/admin-panel/station-settings/", {"accent_color": "#ff6600"}).status_code,
            403,
        )
        self.assertEqual(StationSettings.get().accent_color, "#169154")

    def test_broadcast_toggle_defaults_on_and_patches(self):
        resp = self.client.get("/api/admin-panel/station-settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["broadcast_enabled"])
        resp = self.client.patch("/api/admin-panel/station-settings/", {"broadcast_enabled": False})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data["broadcast_enabled"])
        self.assertFalse(StationSettings.get().broadcast_enabled)

    def test_public_station_config_exposes_broadcast_state(self):
        cfg = StationSettings.get()
        cfg.broadcast_enabled = False
        cfg.save()
        resp = self.client.get("/api/station/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["broadcast_enabled"])

    def test_patch_rejects_non_audio_offair_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self.client.patch(
            "/api/admin-panel/station-settings/",
            {"fallback_audio": SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(StationSettings.get().fallback_audio.name)  # nothing stored


class InitStationTests(APITestCase):
    def test_fresh_wipes_content_and_creates_only_the_admin(self):
        User.objects.create_user(email="old@demo.test", username="old", password="x" * 12, role=Role.LISTENER)
        User.objects.create_user(
            email="ads@demo.test", username="ads", password="x" * 12, role=Role.AD_MANAGER
        )
        Playlist.objects.create(name="Demo rotation", is_default=True)
        advertiser = Advertiser.objects.create(name="Demo brand")
        AudioCampaign.objects.create(name="Demo campaign", advertiser=advertiser)

        call_command(
            "init_station", "--fresh", "--yes",
            email="real@station.fm", password="a-long-password",
            verbosity=0,
        )

        self.assertEqual(User.objects.count(), 1)
        admin = User.objects.get()
        self.assertEqual(admin.email, "real@station.fm")
        self.assertEqual(admin.role, Role.SUPER_ADMIN)
        self.assertEqual(Playlist.objects.count(), 0)
        self.assertEqual(Advertiser.objects.count(), 0)
        self.assertEqual(AudioCampaign.objects.count(), 0)
        self.assertEqual(Track.objects.count(), 0)
        self.assertTrue(admin.check_password("a-long-password"))

    def test_fresh_requires_yes(self):
        with self.assertRaises(CommandError):
            call_command(
                "init_station", "--fresh",
                email="real@station.fm", password="a-long-password", verbosity=0,
            )

    def test_without_fresh_is_idempotent_and_keeps_content(self):
        call_command(
            "init_station", "--email", "real@station.fm", "--password", "a-long-password", verbosity=0
        )
        Playlist.objects.create(name="Main rotation", is_default=True)
        User.objects.create_user(email="listener@x.test", username="l", password="x" * 12)
        self.assertEqual(User.objects.count(), 2)

        # Second run (no --fresh): content and accounts must survive.
        call_command("init_station", "--email", "real@station.fm", verbosity=0)

        self.assertEqual(User.objects.count(), 2)
        self.assertEqual(Playlist.objects.count(), 1)
        admin = User.objects.get(email="real@station.fm")
        self.assertEqual(admin.role, Role.SUPER_ADMIN)

    def test_requires_an_email(self):
        # Explicit empty email: the .env ADMIN_EMAIL default must not mask this.
        with self.assertRaises(CommandError):
            call_command("init_station", email="", verbosity=0)

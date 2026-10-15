"""Bootstrap a real, demo-free station.

This site is functional, not a sandbox: there are no sample tracks, sample
playlists, sample campaigns, or demo logins. The only thing this command
ever creates is a super-admin account — every other record is entered
through the admin dashboard (or the public ad-request form) and lives in
the database.

    python manage.py init_station --fresh --email you@station.fm --password …

`--fresh` first empties the content tables and removes every account, so
what comes up is exactly one admin and nothing else. Without `--fresh` it
only makes sure the given admin exists (idempotent, safe on every deploy).
"""
import os

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Create the station admin account (and, with --fresh, wipe demo/test content first)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fresh", action="store_true",
            help="Delete all content (tracks, playlists, ads, campaigns) and every account first.",
        )
        parser.add_argument(
            "--email", default=os.environ.get("ADMIN_EMAIL", ""),
            help="Admin email (or set ADMIN_EMAIL).",
        )
        parser.add_argument(
            "--password", default=os.environ.get("ADMIN_PASSWORD", ""),
            help="Admin password (or set ADMIN_PASSWORD).",
        )
        parser.add_argument(
            "--yes", action="store_true",
            help="Skip the confirmation prompt for --fresh.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.accounts.models import Role, User

        email = (options["email"] or "").strip().lower()
        password = options["password"] or ""

        if not email:
            raise CommandError("An admin email is required (--email or ADMIN_EMAIL).")

        if options["fresh"]:
            if not options["yes"]:
                raise CommandError(
                    "--fresh deletes ALL content and every account. "
                    "Re-run with --yes to confirm."
                )
            deleted = self._wipe_everything()
            self.stdout.write(self.style.SUCCESS(
                "Wiped existing content: " + ", ".join(f"{k}={v}" for k, v in deleted.items() if v)
                if any(deleted.values()) else "Wiped existing content: nothing to delete."
            ))

        user = User.objects.filter(email=email).first()
        if user is None:
            if not password:
                raise CommandError(
                    f"No account for {email} and no password given. "
                    "Pass --password (or ADMIN_PASSWORD) to create it."
                )
            base = email.split("@")[0]
            username = base
            suffix = 2
            while User.objects.filter(username=username).exists():
                username = f"{base}{suffix}"
                suffix += 1
            user = User.objects.create_user(
                email=email, username=username, password=password, role=Role.SUPER_ADMIN
            )
            self.stdout.write(self.style.SUCCESS(f"Created super admin {email}."))
        else:
            changed = []
            if user.role != Role.SUPER_ADMIN:
                user.role = Role.SUPER_ADMIN
                user.is_staff = True
                user.is_superuser = True
                changed.append("role -> super_admin")
            if password:
                user.set_password(password)
                changed.append("password reset")
            if changed:
                user.save()
                self.stdout.write(self.style.SUCCESS(f"Updated {email}: {', '.join(changed)}."))
            else:
                self.stdout.write(f"Admin {email} already exists — left unchanged.")

        self.stdout.write(
            "\nNext steps (all data lives in the database):\n"
            "  1. Sign in as the admin and open /admin\n"
            "  2. Settings  - set the station name and theme colour\n"
            "  3. Music library - upload your tracks (they enter rotation when enabled)\n"
            "  4. Playlists - create the main rotation and add those tracks\n"
            "  5. Ad requests / Banner campaigns / Audio campaigns - sell and schedule ads\n"
        )

    def _wipe_everything(self) -> dict:
        """Delete every content record; media files go with the rows."""
        from apps.accounts.models import User
        from apps.advertising.models import (
            AdBreakLog,
            AdRequest,
            AdSchedule,
            Advertiser,
            AudioAdvert,
            AudioCampaign,
            ClickEvent,
            ImpressionEvent,
            VisualCampaign,
        )
        from apps.broadcast.models import BroadcastHistory, BroadcastState, Playlist, Track

        counts = {
            "tracks": Track.objects.count(),
            "playlists": Playlist.objects.count(),
            "adverts": AudioAdvert.objects.count(),
            "audio_campaigns": AudioCampaign.objects.count(),
            "schedules": AdSchedule.objects.count(),
            "break_logs": AdBreakLog.objects.count(),
            "banner_campaigns": VisualCampaign.objects.count(),
            "advertisers": Advertiser.objects.count(),
            "ad_requests": AdRequest.objects.count(),
            "impressions": ImpressionEvent.objects.count(),
            "clicks": ClickEvent.objects.count(),
            "broadcast_history": BroadcastHistory.objects.count(),
            "users": User.objects.count(),
        }

        # Order matters for plain FKs; M2M rows and cascades follow their parents.
        AdSchedule.objects.all().delete()
        AdBreakLog.objects.all().delete()
        AudioCampaign.objects.all().delete()
        AudioAdvert.objects.all().delete()
        ImpressionEvent.objects.all().delete()
        ClickEvent.objects.all().delete()
        VisualCampaign.objects.all().delete()
        AdRequest.objects.all().delete()
        Advertiser.objects.all().delete()
        Playlist.objects.all().delete()
        Track.objects.all().delete()  # playlist entries cascade; files are removed
        BroadcastHistory.objects.all().delete()
        BroadcastState.objects.all().delete()
        User.objects.all().delete()
        return counts

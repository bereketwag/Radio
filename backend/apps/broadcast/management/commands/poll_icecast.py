"""Poll Icecast for the real connected-listener count.

Run on a schedule (cron / systemd timer), e.g. every minute:

    python manage.py poll_icecast

The actual fetch lives in services.poll_icecast_listeners (shared with the
background poller thread started in BroadcastConfig.ready). If Icecast is
unreachable, the count is cleared to None — the site then shows
"listeners: —" instead of a fabricated number.
"""
from django.core.management.base import BaseCommand

from apps.broadcast import services


class Command(BaseCommand):
    help = "Poll Icecast for the real connected listener count."

    def handle(self, *args, **options):
        outcome, count = services.poll_icecast_listeners()
        if outcome == "skipped":
            self.stdout.write("ICECAST_STATS_URL not configured; skipping listener poll.")
        elif outcome == "updated":
            self.stdout.write(f"Icecast listeners: {count}")
        else:
            self.stdout.write("Icecast unreachable; listener count cleared.")

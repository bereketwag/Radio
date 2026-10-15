"""Poll Icecast for the real connected-listener count.

Run on a schedule (cron / systemd timer), e.g. every minute:

    python manage.py poll_icecast

Writes the measured count into BroadcastState via services.update_listeners.
If Icecast is unreachable, the count is cleared to None — the site then shows
"listeners: —" instead of a fabricated number.
"""
import json
import logging
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.broadcast import services

logger = logging.getLogger("apps")


class Command(BaseCommand):
    help = "Poll Icecast for the real connected listener count."

    def handle(self, *args, **options):
        base = settings.ICECAST_STATS_URL.rstrip("/")
        if not base:
            self.stdout.write("ICECAST_STATS_URL not configured; skipping listener poll.")
            return
        url = f"{base}/status-json.xsl?mount=/{settings.ICECAST_MOUNT.lstrip('/')}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            stats = data.get("icestats", {})
            source = stats.get("source")
            if isinstance(source, list):
                source = source[0] if source else {}
            count = int(source.get("listeners", 0)) if source else 0
            services.update_listeners(count)
            self.stdout.write(f"Icecast listeners: {count}")
        except Exception as exc:
            logger.warning("icecast poll failed: %s", exc)
            services.update_listeners(None)
            self.stdout.write(f"Icecast unreachable ({exc}); listener count cleared.")

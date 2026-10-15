"""Sweep ad breaks whose windows expired without engine confirmation.

Run on a schedule (cron / systemd timer), e.g. every 5 minutes:

    python manage.py check_ad_breaks
"""
from django.core.management.base import BaseCommand

from apps.advertising import services


class Command(BaseCommand):
    help = "Mark scheduled ad breaks that were never confirmed as played (missed)."

    def handle(self, *args, **options):
        marked = services.close_missed_breaks()
        self.stdout.write(f"Marked {marked} ad break(s) as missed.")

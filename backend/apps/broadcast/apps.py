import logging
import sys
import threading
import time

from django.apps import AppConfig

logger = logging.getLogger("apps")

# Only poll when this process actually serves traffic. Tests must not spawn
# the thread (a live poll could write listeners mid-test), and management
# commands like migrate/collectstatic should not either.
_SERVING_ARGV = ("runserver", "gunicorn", "daphne", "uvicorn")
_POLL_SECONDS = 30
_poller_started = False


def _listener_poll_loop() -> None:
    from . import services

    # Let migrations/settle finish before the first write attempt; failures
    # must never kill the thread — the loop just retries next tick.
    time.sleep(5)
    while True:
        try:
            services.poll_icecast_listeners()
        except Exception:
            logger.exception("background listener poll failed")
        time.sleep(_POLL_SECONDS)


class BroadcastConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.broadcast"
    verbose_name = "Broadcast"

    def ready(self) -> None:
        global _poller_started
        if _poller_started:
            return
        if "test" in sys.argv:
            return
        if not any(token in sys.argv[0] or token in sys.argv for token in _SERVING_ARGV):
            return
        from django.conf import settings

        if not settings.ICECAST_STATS_URL.rstrip("/"):
            return
        _poller_started = True
        threading.Thread(
            target=_listener_poll_loop, name="icecast-listeners", daemon=True
        ).start()

from django.urls import path

from . import internal_views

urlpatterns = [
    path("ingest/", internal_views.ingest, name="internal-ingest"),
    path("heartbeat/", internal_views.heartbeat, name="internal-heartbeat"),
    path("force-play/", internal_views.force_play, name="internal-force-play"),
    path("listeners/", internal_views.listeners, name="internal-listeners"),
    path("playlist.m3u", internal_views.playlist_m3u, name="internal-playlist"),
    path("offair.m3u", internal_views.offair_m3u, name="internal-offair"),
    path("ad-break/", internal_views.ad_break_state, name="internal-ad-break"),
    path("ad-played/", internal_views.ad_played, name="internal-ad-played"),
    path("airings/", internal_views.recent_airings, name="internal-airings"),
]

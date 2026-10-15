from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.common import views as common_views

from . import admin_views

router = DefaultRouter()
router.register("ad-requests", admin_views.AdRequestViewSet, basename="ad-request")
router.register("advertisers", admin_views.AdvertiserViewSet, basename="advertiser")
router.register("visual-campaigns", admin_views.VisualCampaignViewSet, basename="visual-campaign")
router.register("audio-adverts", admin_views.AudioAdvertViewSet, basename="audio-advert")
router.register("audio-campaigns", admin_views.AudioCampaignViewSet, basename="audio-campaign")
router.register("ad-schedules", admin_views.AdScheduleViewSet, basename="ad-schedule")
router.register("ad-break-logs", admin_views.AdBreakLogViewSet, basename="ad-break-log")
router.register("tracks", admin_views.TrackViewSet, basename="track")
router.register("off-air-tracks", admin_views.OffAirTrackViewSet, basename="off-air-track")
router.register("playlists", admin_views.PlaylistViewSet, basename="playlist")
router.register("users", admin_views.AdminUserViewSet, basename="admin-user")

urlpatterns = [
    path("overview/", admin_views.overview),
    path("audit-logs/", admin_views.audit_logs),
    path("health-events/", admin_views.health_events),
    path("ad-breaks/check/", admin_views.run_ad_break_check),
    path("station-settings/", common_views.station_settings, name="station-settings"),
    path("", include(router.urls)),
]

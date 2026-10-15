from django.urls import path

from . import views

urlpatterns = [
    path("banners/", views.banner_rotation, name="ad-banners"),
    path("banners/<str:campaign_id>/impression/", views.track_impression, name="ad-impression"),
    path("banners/<str:campaign_id>/click/", views.track_click, name="ad-click"),
    path("requests/", views.submit_ad_request, name="ad-requests"),
    path("requests/mine/", views.my_ad_requests, name="ad-requests-mine"),
]

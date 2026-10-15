from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("station/", views.station_config, name="station-config"),
]

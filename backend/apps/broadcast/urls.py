from django.urls import path

from . import views

urlpatterns = [
    path("now-playing/", views.now_playing, name="broadcast-now-playing"),
    path("now-playing/stream/", views.now_playing_stream, name="broadcast-sse"),
    path("history/", views.history, name="broadcast-history"),
    path("stream/", views.stream_info, name="broadcast-stream-info"),
]

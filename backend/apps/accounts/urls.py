from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("users", views.UserViewSet)

urlpatterns = [
    path("register/", views.register),
    path("login/", views.login),
    path("logout/", views.logout),
    path("me/", views.me),
    path("password-reset/", views.password_reset_request),
    path("password-reset/confirm/", views.password_reset_confirm),
    path("", include(router.urls)),
]

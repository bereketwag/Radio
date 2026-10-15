from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("apps.common.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/broadcast/", include("apps.broadcast.urls")),
    path("api/ads/", include("apps.advertising.urls")),
    path("api/internal/", include("apps.broadcast.internal_urls")),
    path("api/admin-panel/", include("apps.advertising.admin_urls")),
]

# Serve uploaded media from Django in development, and in any local-storage
# deployment (docker-compose) where the nginx proxy forwards /media/ here.
# Object-storage backends (S3) set SERVE_MEDIA=false and serve directly.
if settings.DEBUG or settings.SERVE_MEDIA:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

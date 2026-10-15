"""Django settings for the Aurora Radio backend."""
from pathlib import Path
from urllib.parse import urlparse

from .environ import BASE_DIR, env, env_bool, env_int, load_dotenv

load_dotenv()

SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-secret-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = [h.strip() for h in env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "apps.common",
    "apps.accounts",
    "apps.broadcast",
    "apps.advertising",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# Database — PostgreSQL in production, SQLite for local development/tests.
# ---------------------------------------------------------------------------
DATABASE_URL = env("DATABASE_URL", "")
if DATABASE_URL:
    db_url = urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": db_url.path.lstrip("/"),
            "USER": db_url.username or "",
            "PASSWORD": db_url.password or "",
            "HOST": db_url.hostname or "localhost",
            "PORT": str(db_url.port or 5432),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"  # storage & broadcast timeline are always UTC
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    # Swap for object storage in production, e.g.
    # storages.backends.s3boto3.S3Boto3Storage (see apps/common/storage.py).
    "default": {
        "BACKEND": env("DEFAULT_STORAGE_BACKEND", "apps.common.storage.MediaStorage")
    },
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Radio station configuration (env-driven; surfaced to the frontend via API)
# ---------------------------------------------------------------------------
STATION_NAME = env("STATION_NAME", "Aurora Radio")
STATION_TAGLINE = env("STATION_TAGLINE", "One live stream. The whole planet listening.")
STATION_TIMEZONE = env("STATION_TIMEZONE", "UTC")
STATION_CONTACT_EMAIL = env("STATION_CONTACT_EMAIL", "hello@auroraradio.example")
STATION_CONTACT_ADDRESS = env("STATION_CONTACT_ADDRESS", "")
STATION_SOCIAL = {
    "instagram": env("STATION_SOCIAL_INSTAGRAM", ""),
    "x": env("STATION_SOCIAL_X", ""),
    "youtube": env("STATION_SOCIAL_YOUTUBE", ""),
    "facebook": env("STATION_SOCIAL_FACEBOOK", ""),
    "tiktok": env("STATION_SOCIAL_TIKTOK", ""),
}
# Public URL listeners use to reach the stream (served through the proxy in
# docker-compose, so it is same-origin for the browser).
STREAM_PUBLIC_URL = env("STREAM_PUBLIC_URL", "/live/radio")
# Origin the *engine* (Liquidsoap) uses to fetch media from this backend,
# e.g. http://backend:8000 inside docker-compose. Used to build absolute
# URLs in the M3U playlist and the ad-break queue.
PUBLIC_BACKEND_URL = env("PUBLIC_BACKEND_URL", "http://localhost:8000")
# Serve /media/ from Django outside DEBUG (local-storage deployments behind
# the nginx proxy). Object-storage backends don't need it.
SERVE_MEDIA = env_bool("SERVE_MEDIA", DEBUG)
# Internal Icecast base URL for server-side stats lookups.
ICECAST_STATS_URL = env("ICECAST_STATS_URL", "")
ICECAST_MOUNT = env("ICECAST_MOUNT", "radio")
# Shared secret Liquidsoap uses to authenticate internal endpoints.
BROADCAST_API_KEY = env("BROADCAST_API_KEY", "dev-broadcast-key-change-me")

# Upload limits
MAX_AUDIO_UPLOAD_MB = env_int("MAX_AUDIO_UPLOAD_MB", 50)
MAX_IMAGE_UPLOAD_MB = env_int("MAX_IMAGE_UPLOAD_MB", 5)
ALLOWED_AUDIO_EXTENSIONS = {"mp3", "ogg", "opus", "flac", "m4a", "aac", "wav"}
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

# ---------------------------------------------------------------------------
# DRF
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticatedOrReadOnly"],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon_write": env("ANON_THROTTLE_RATE", "30/hour"),
        "auth": env("AUTH_THROTTLE_RATE", "10/hour"),
        "ad_request": env("AD_REQUEST_THROTTLE_RATE", "5/hour"),
        "ad_event": env("AD_EVENT_THROTTLE_RATE", "120/minute"),
        "internal": env("INTERNAL_THROTTLE_RATE", "600/minute"),
    },
}

# ---------------------------------------------------------------------------
# CORS — the Vite dev server and (optionally) a separate static host
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in env("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

# Public origin of the React app — used to build links that must land on a page
# the browser can render (e.g. the password-reset SPA route). Falls back to the
# first CORS origin, which is the Vite dev server by default.
FRONTEND_URL = env("FRONTEND_URL", CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "").rstrip("/")

# ---------------------------------------------------------------------------
# Security — env-toggled so local dev stays simple while prod is hardened
# ---------------------------------------------------------------------------
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in env("CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://localhost:8000").split(",")
    if o.strip()
]
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False  # frontend reads the CSRF cookie for DRF session auth
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)

# ---------------------------------------------------------------------------
# Email — console backend by default; configure SMTP via env in production
# ---------------------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Aurora Radio <no-reply@auroraradio.example>")

# ---------------------------------------------------------------------------
# Logging — structured single-line JSON-ish logs
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "structured": {
            "()": "apps.common.logging.StructuredFormatter",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "structured"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"level": "WARNING", "propagate": True},
        "apps": {"level": "INFO", "propagate": True},
    },
}

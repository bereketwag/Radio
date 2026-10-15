"""Upload validation shared by the music library and the ad-creative endpoints.

The limits live in settings (MAX_AUDIO_UPLOAD_MB, ALLOWED_AUDIO_EXTENSIONS, …)
so an operator can tighten them without a code change; these helpers turn a
rejected file into a readable API error instead of a 500 or a silent accept.
"""
from django.conf import settings
from django.core.exceptions import ValidationError


def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _size_error(value, limit_mb: int) -> None:
    size = getattr(value, "size", 0) or 0
    if size > limit_mb * 1024 * 1024:
        raise ValidationError(
            f"File is {size / (1024 * 1024):.1f} MB — the limit is {limit_mb} MB."
        )


def validate_audio_upload(value):
    """Accept only the container formats the broadcast engine can decode."""
    allowed = settings.ALLOWED_AUDIO_EXTENSIONS
    ext = _extension(getattr(value, "name", "") or "")
    if ext not in allowed:
        raise ValidationError(
            f"Unsupported audio format “{ext or value.name}”. "
            f"Allowed: {', '.join(sorted(allowed))}."
        )
    _size_error(value, settings.MAX_AUDIO_UPLOAD_MB)


def validate_image_upload(value):
    """Accept only the image formats the site renders (JPG/PNG/WebP)."""
    allowed = settings.ALLOWED_IMAGE_EXTENSIONS
    ext = _extension(getattr(value, "name", "") or "")
    if ext not in allowed:
        raise ValidationError(
            f"Unsupported image format “{ext or value.name}”. "
            f"Allowed: {', '.join(sorted(allowed))}."
        )
    _size_error(value, settings.MAX_IMAGE_UPLOAD_MB)

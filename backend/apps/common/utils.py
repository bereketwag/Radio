"""Small shared helpers used by the broadcast and advertising services."""


def public_media_url(url: str) -> str:
    """Absolute URL for a media file that the Liquidsoap engine can fetch.

    FileField.url is site-relative ("/media/…"). The engine runs outside the
    web process and needs an absolute URL (e.g. http://backend:8000/media/…).
    Already-absolute URLs pass through unchanged.
    """
    if not url:
        return ""
    if url.startswith(("http://", "https://")):
        return url
    from django.conf import settings

    return f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{url}"


def probe_audio_duration(path) -> int | None:
    """Length in whole seconds of an audio file, or None if unreadable.

    Uses mutagen when available; returns None rather than raising so a
    corrupt upload can never break the request that saved it.
    """
    try:
        from mutagen import File as MutagenFile

        parsed = MutagenFile(path)
        length = getattr(getattr(parsed, "info", None), "length", None)
        if length and length > 0:
            return int(round(length))
    except Exception:
        return None
    return None


def probe_stored_audio_duration(storage_file) -> int | None:
    """Duration of an already-saved FileField, on any storage backend.

    Local storage exposes a filesystem path; object-storage backends raise
    NotImplementedError for `.path`, so fall back to reading the stored
    stream. Anything unreadable stays None — never a 500 on upload.
    """
    if not storage_file:
        return None
    try:
        return probe_audio_duration(storage_file.path)
    except NotImplementedError:
        pass
    except Exception:
        return None
    try:
        with storage_file.open("rb") as fh:
            return probe_audio_duration(fh)
    except Exception:
        return None

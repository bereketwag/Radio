"""File storage abstraction.

Local filesystem storage is used by default (a media volume in Docker).
For production object storage, install django-storages and set in .env:

    DEFAULT_STORAGE_BACKEND=storages.backends.s3boto3.S3Boto3Storage
    AWS_STORAGE_BUCKET_NAME=...
    AWS_S3_REGION_NAME=...
    AWS_ACCESS_KEY_ID=... / AWS_SECRET_ACCESS_KEY=...

Any storages backend import path works; settings.py reads the variable and
falls back to the local MediaStorage below.
"""
from django.core.files.storage import FileSystemStorage


class MediaStorage(FileSystemStorage):
    """Default local media storage, served under /media/."""

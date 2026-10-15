import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    SUPER_ADMIN = "super_admin", "Super administrator"
    STATION_ADMIN = "station_admin", "Station administrator"
    AD_MANAGER = "ad_manager", "Advertising manager"
    ADVERTISER = "advertiser", "Advertiser"
    LISTENER = "listener", "Listener"


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.LISTENER)
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=120, blank=True, default="")
    organization = models.CharField(max_length=160, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email

    @property
    def is_station_staff(self) -> bool:
        return self.is_superuser or self.role in {Role.SUPER_ADMIN, Role.STATION_ADMIN}

    @property
    def is_advertising_staff(self) -> bool:
        return self.is_station_staff or self.role == Role.AD_MANAGER


class PasswordResetToken(models.Model):
    """Single-use password recovery token (emailed to the user)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_tokens")
    created_at = models.DateTimeField(auto_now_add=True)
    used = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def is_valid(self) -> bool:
        from django.utils import timezone

        if self.used:
            return False
        age = timezone.now() - self.created_at
        return age.total_seconds() < 3600 * 2  # 2 hour expiry

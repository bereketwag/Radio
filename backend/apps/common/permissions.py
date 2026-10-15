from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.models import Role


def user_has_role(user, *roles: str) -> bool:
    return bool(user and user.is_authenticated and (user.role in roles or user.is_superuser))


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return user_has_role(request.user, Role.SUPER_ADMIN)


class IsStationAdmin(BasePermission):
    """Super admin or station administrator."""

    def has_permission(self, request, view):
        return user_has_role(request.user, Role.SUPER_ADMIN, Role.STATION_ADMIN)


class IsAdvertisingTeam(BasePermission):
    """Super admin, station admin, or advertising manager."""

    def has_permission(self, request, view):
        return user_has_role(request.user, Role.SUPER_ADMIN, Role.STATION_ADMIN, Role.AD_MANAGER)


class IsAdvertiser(BasePermission):
    def has_permission(self, request, view):
        return user_has_role(request.user, Role.SUPER_ADMIN, Role.STATION_ADMIN, Role.ADVERTISER)


class ReadOnly(BasePermission):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS

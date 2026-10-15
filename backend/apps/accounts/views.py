import logging

from django.conf import settings
from django.contrib.auth import authenticate
from django.core.mail import send_mail
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.common.models import log_audit
from apps.common.permissions import IsSuperAdmin, user_has_role

from .models import PasswordResetToken, Role, User
from .serializers import (
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    RoleUpdateSerializer,
    UserSerializer,
)

logger = logging.getLogger("apps")


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    ser = RegisterSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = ser.save()
    token, _ = Token.objects.get_or_create(user=user)
    log_audit(user, "account.register", "user", str(user.id), f"Registered {user.email}")
    return Response({"user": UserSerializer(user).data, "token": token.key}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    ser = LoginSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = authenticate(request, email=ser.validated_data["email"], password=ser.validated_data["password"])
    if user is None or not user.is_active:
        return Response({"detail": "Invalid email or password."}, status=status.HTTP_400_BAD_REQUEST)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"user": UserSerializer(user).data, "token": token.key})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"detail": "Signed out."})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request):
    if request.method == "PATCH":
        ser = UserSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.validated_data and UserSerializer(request.user).data)
    return Response(UserSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_request(request):
    ser = PasswordResetRequestSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    email = ser.validated_data["email"]
    user = User.objects.filter(email=email, is_active=True).first()
    if user:
        token = PasswordResetToken.objects.create(user=user)
        # The link must land on the React app (there is a /reset-password route),
        # not on the API origin — the API has no page to render the form.
        base = settings.FRONTEND_URL or request.build_absolute_uri("/").rstrip("/")
        reset_url = f"{base}/reset-password?token={token.id}"
        send_mail(
            "Reset your Aurora Radio password",
            f"Use this link within 2 hours to reset your password: {reset_url}\n"
            "If you did not request this, ignore this email.",
            settings.DEFAULT_FROM_EMAIL,
            [email],
        )
    # Always the same response — do not leak which emails exist.
    return Response({"detail": "If that email has an account, a reset link has been sent."})


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_confirm(request):
    ser = PasswordResetConfirmSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    record = PasswordResetToken.objects.filter(id=ser.validated_data["token"], used=False).select_related("user").first()
    if record is None or not record.is_valid():
        return Response({"detail": "This reset link is invalid or has expired."}, status=status.HTTP_400_BAD_REQUEST)
    user = record.user
    user.set_password(ser.validated_data["password"])
    user.save(update_fields=["password"])
    record.used = True
    record.save(update_fields=["used"])
    Token.objects.filter(user=user).delete()  # invalidate existing sessions
    log_audit(user, "account.password_reset", "user", str(user.id), f"Password reset for {user.email}")
    return Response({"detail": "Password updated. Please sign in again."})


class UserViewSet(ModelViewSet):
    """Administrative user management (super admin only for writes)."""

    queryset = User.objects.all().order_by("email")
    serializer_class = UserSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), _IsStationStaff()]
        return [IsSuperAdmin()]

    def get_serializer_class(self):
        if self.action == "change_role":
            return RoleUpdateSerializer
        return UserSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        role = self.request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        q = self.request.query_params.get("search")
        if q:
            qs = qs.filter(email__icontains=q)
        return qs

    @action(detail=True, methods=["post"], url_path="change-role")
    def change_role(self, request, pk=None):
        user = self.get_object()
        ser = RoleUpdateSerializer(user, data=request.data)
        ser.is_valid(raise_exception=True)
        old = user.role
        ser.save()
        log_audit(request.user, "user.change_role", "user", str(user.id), f"{user.email}: {old} -> {user.role}")
        return Response(UserSerializer(user).data)


class _IsStationStaff(BasePermission):
    """Super admin or station admin (may view users)."""

    def has_permission(self, request, view):
        return user_has_role(request.user, Role.SUPER_ADMIN, Role.STATION_ADMIN)

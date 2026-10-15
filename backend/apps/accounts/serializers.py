from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "username", "display_name", "role", "organization", "phone", "date_joined"]
        read_only_fields = ["id", "role", "date_joined"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "username", "display_name", "organization", "phone", "password", "password_confirm"]

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        return attrs

    def create(self, validated_data):
        username = validated_data.get("username") or validated_data["email"].split("@")[0]
        # Ensure the auto-derived username is unique.
        base, n = username, 1
        while User.objects.filter(username=username).exists():
            username = f"{base}{n}"
            n += 1
        validated_data["username"] = username
        user = User(**validated_data)
        user.set_password(validated_data["password"])
        user.role = Role.LISTENER  # never self-assign privileged roles
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.UUIDField()
    password = serializers.CharField(write_only=True, validators=[validate_password])


class RoleUpdateSerializer(serializers.ModelSerializer):
    """Role changes are restricted to super admins via the view's permission."""

    class Meta:
        model = User
        fields = ["role"]


class AdminCreateUserSerializer(serializers.ModelSerializer):
    """Staff-created accounts. Role is chosen by the admin, never by self-serve register."""

    password = serializers.CharField(write_only=True, validators=[validate_password])
    username = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["email", "username", "display_name", "organization", "phone", "password", "role"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        username = validated_data.get("username") or validated_data["email"].split("@")[0]
        base, n = username, 1
        while User.objects.filter(username=username).exists():
            username = f"{base}{n}"
            n += 1
        validated_data["username"] = username
        role = validated_data.get("role") or Role.LISTENER
        user = User(**validated_data)
        user.set_password(password)
        user.is_staff = role in {Role.SUPER_ADMIN, Role.STATION_ADMIN, Role.AD_MANAGER}
        user.is_superuser = role == Role.SUPER_ADMIN
        user.save()
        return user

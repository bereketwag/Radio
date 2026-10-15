from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("email", "username", "role", "is_active", "date_joined")
    list_filter = ("role", "is_active")
    search_fields = ("email", "username")
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("Station", {"fields": ("role", "display_name", "organization", "phone")}),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("Station", {"fields": ("email", "role")}),
    )

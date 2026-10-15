from django.contrib import admin

from .models import AuditLog, HealthEvent


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "object_type", "object_id", "actor_email", "created_at")
    list_filter = ("action", "object_type")


@admin.register(HealthEvent)
class HealthEventAdmin(admin.ModelAdmin):
    list_display = ("code", "source", "severity", "resolved", "created_at")
    list_filter = ("severity", "source", "resolved")

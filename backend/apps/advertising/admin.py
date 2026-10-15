from django.contrib import admin

from .models import (
    AdBreakLog,
    AdRequest,
    AdSchedule,
    Advertiser,
    AudioAdvert,
    AudioCampaign,
    ClickEvent,
    ImpressionEvent,
    VisualCampaign,
)


@admin.register(Advertiser)
class AdvertiserAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "contact_name", "created_at")
    search_fields = ("name", "email")


@admin.register(AdRequest)
class AdRequestAdmin(admin.ModelAdmin):
    list_display = ("business_name", "ad_format", "status", "created_at")
    list_filter = ("status", "ad_format")


@admin.register(VisualCampaign)
class VisualCampaignAdmin(admin.ModelAdmin):
    list_display = ("name", "advertiser", "status", "payment_status", "priority", "impressions", "clicks")
    list_filter = ("status", "payment_status", "placement")


class AdScheduleInline(admin.TabularInline):
    model = AdSchedule
    extra = 0


@admin.register(AudioCampaign)
class AudioCampaignAdmin(admin.ModelAdmin):
    list_display = ("name", "advertiser", "status", "payment_status", "priority")
    list_filter = ("status", "payment_status")
    inlines = [AdScheduleInline]


@admin.register(AudioAdvert)
class AudioAdvertAdmin(admin.ModelAdmin):
    list_display = ("name", "duration_seconds", "approved", "active")


@admin.register(AdBreakLog)
class AdBreakLogAdmin(admin.ModelAdmin):
    list_display = ("campaign", "scheduled_for", "result", "seconds_played")
    list_filter = ("result",)


admin.site.register(ImpressionEvent)
admin.site.register(ClickEvent)

from django.contrib import admin

from .models import BroadcastHistory, BroadcastState, Playlist, PlaylistEntry, Track


class PlaylistEntryInline(admin.TabularInline):
    model = PlaylistEntry
    extra = 0


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ("title", "artist", "album", "duration_seconds", "enabled", "isrc")
    list_filter = ("enabled", "explicit")
    search_fields = ("title", "artist", "album", "isrc")


@admin.register(Playlist)
class PlaylistAdmin(admin.ModelAdmin):
    list_display = ("name", "is_default", "is_fallback", "enabled")
    inlines = [PlaylistEntryInline]


@admin.register(BroadcastState)
class BroadcastStateAdmin(admin.ModelAdmin):
    list_display = ("kind", "title", "artist", "started_at", "engine_online", "listeners")


@admin.register(BroadcastHistory)
class BroadcastHistoryAdmin(admin.ModelAdmin):
    list_display = ("title", "artist", "kind", "started_at", "duration_seconds")
    list_filter = ("kind",)

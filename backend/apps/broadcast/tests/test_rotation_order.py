"""Rotation round-robin: the engine resets to the head of the m3u on every
reload (~15s), so the export must always start at "the song after the one on
air" — otherwise only entries 0-1 ever air and any track longer than the
reload interval starves the rest of the library (the reported bug: five
songs uploaded, only one ever plays).

Covers both engine playlists: the music rotation (default playlist, override
playlist, raw-library fallback) and the off-air waiting list.
"""
import io
import tempfile
import wave

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.broadcast import services
from apps.broadcast.models import OffAirTrack, Playlist, Track

MEDIA = tempfile.mkdtemp(prefix="aurora-rotation-media-")


def wav_upload(name: str) -> SimpleUploadedFile:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x80" * 8000)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="audio/wav")


def titles(lines: list[str]) -> list[str]:
    """Display names from EXTINF lines of an exported m3u."""
    return [line.split(",", 1)[1] for line in lines if line.startswith("#EXTINF:")]


@override_settings(MEDIA_ROOT=MEDIA)
class RotationOrderTests(APITestCase):
    def setUp(self):
        self.tracks = [
            Track.objects.create(title=f"Song {i}", artist="", duration_seconds=60 + i,
                                 audio_file=wav_upload(f"song{i}.wav"))
            for i in (1, 2, 3)
        ]
        self.playlist = Playlist.objects.create(name="Main", is_default=True, enabled=True)
        for i, track in enumerate(self.tracks):
            self.playlist.entries.create(track=track, position=i)

    def engine_m3u(self) -> str:
        from django.conf import settings

        resp = self.client.get("/api/internal/playlist.m3u", HTTP_X_BROADCAST_KEY=settings.BROADCAST_API_KEY)
        self.assertEqual(resp.status_code, 200)
        return resp.content.decode()

    def test_engine_endpoint_serves_the_rotated_order(self):
        services.ingest_metadata({"kind": "music", "title": "Song 1", "duration_seconds": 61})
        self.assertEqual(titles(self.engine_m3u().splitlines()), ["Song 2", "Song 3", "Song 1"])

    def test_m3u_starts_after_the_on_air_track(self):
        # Song 1 is on air → the head (where the engine restarts every reload)
        # must be Song 2, not Song 1, or the rotation never advances.
        services.ingest_metadata({"kind": "music", "title": "Song 1", "duration_seconds": 61})
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 2", "Song 3", "Song 1"])

    def test_rotation_wraps_around_from_the_last_track(self):
        services.ingest_metadata({"kind": "music", "title": "Song 3", "duration_seconds": 63})
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 1", "Song 2", "Song 3"])

    def test_library_order_when_nothing_has_aired_yet(self):
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 1", "Song 2", "Song 3"])

    def test_on_air_track_outside_the_list_is_served_unrotated(self):
        # Force-played / override leftovers must not scramble the rotation.
        other = Track.objects.create(title="Guest Mix", audio_file=wav_upload("guest.wav"))
        services.ingest_metadata({"kind": "music", "title": other.title, "duration_seconds": 10})
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 1", "Song 2", "Song 3"])

    def test_rotation_survives_disable_and_reorder(self):
        services.ingest_metadata({"kind": "music", "title": "Song 2", "duration_seconds": 62})
        self.tracks[0].enabled = False
        self.tracks[0].save(update_fields=["enabled"])
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 3", "Song 2"])

    def test_duplicate_titles_never_anchor_on_the_on_air_song(self):
        # Two tracks share one title (ingest cannot tell them apart) — the
        # head must be neither of them, or the engine could replay the song
        # that is already playing, forever.
        dupe_a, dupe_b = self.tracks[1], self.tracks[2]
        dupe_a.title = dupe_b.title = "Twin Song"
        dupe_a.save(update_fields=["title"])
        dupe_b.save(update_fields=["title"])
        services.ingest_metadata({"kind": "music", "title": "Twin Song", "duration_seconds": 62})
        served = titles(services.export_playlist_m3u())
        self.assertEqual(served, ["Song 1", "Twin Song", "Twin Song"])  # head = the only non-twin
        self.assertEqual(served[0], "Song 1")


@override_settings(MEDIA_ROOT=MEDIA)
class UriAnchorIngestTests(APITestCase):
    """ID3 tags inside a file can blank or rewrite the title Liquidsoap
    parses (seen live: a 319s song reported as "(unknown)", which reset
    the rotation anchor and restarted the old two-song loop). The engine
    now reports the file's URL with every now-playing POST, and ingest
    matches the library entry by that URL — tags can no longer break
    the rotation."""

    def setUp(self):
        self.tracks = [
            Track.objects.create(title=f"Song {i}", artist="", duration_seconds=60 + i,
                                 audio_file=wav_upload(f"song{i}.wav"))
            for i in (1, 2, 3)
        ]

    def engine_uri(self, track: Track) -> str:
        from apps.common.utils import public_media_url

        return public_media_url(track.audio_file.url)

    def test_uri_report_with_empty_title_links_the_track(self):
        state = services.ingest_metadata({
            "kind": "music", "title": "", "uri": self.engine_uri(self.tracks[1]),
            "duration_seconds": 62,
        })
        self.assertEqual(state.track_id, self.tracks[1].id)
        self.assertEqual(state.title, "Song 2")  # library title fills the blank

    def test_uri_anchor_rotates_the_playlist_past_the_on_air_song(self):
        services.ingest_metadata({
            "kind": "music", "title": "", "uri": self.engine_uri(self.tracks[0]),
            "duration_seconds": 61,
        })
        self.assertEqual(titles(services.export_playlist_m3u()), ["Song 2", "Song 3", "Song 1"])

    def test_percent_encoded_uri_still_matches(self):
        # The engine fetches the percent-encoded form (Amharic filenames).
        from urllib.parse import quote

        uri = quote(self.engine_uri(self.tracks[2]), safe=":/")
        state = services.ingest_metadata({"kind": "music", "title": "", "uri": uri})
        self.assertEqual(state.track_id, self.tracks[2].id)

    def test_unicode_decoded_uri_still_matches(self):
        # Liquidsoap normalizes percent-encoded URLs to Unicode before
        # storing initial_uri — an Amharic filename must match either way.
        from urllib.parse import unquote

        ethiopic = Track.objects.create(
            title="ዜማ", artist="", duration_seconds=90,
            audio_file=wav_upload("ዜማ_ለክርስቶስ.mp3"),
        )
        encoded = self.engine_uri(ethiopic)  # FileField.url is already percent-encoded
        state = services.ingest_metadata({"kind": "music", "title": "", "uri": encoded})
        self.assertEqual(state.track_id, ethiopic.id)
        state = services.ingest_metadata({"kind": "music", "title": "", "uri": unquote(encoded)})
        self.assertEqual(state.track_id, ethiopic.id)

    def test_offair_uri_report_with_empty_title_anchors_the_waiting_list(self):
        waiting = [
            OffAirTrack.objects.create(title=f"Waiting {i}", audio_file=wav_upload(f"w{i}.wav"))
            for i in (1, 2, 3)
        ]
        from apps.common.utils import public_media_url

        services.ingest_metadata({
            "kind": "music", "title": "",
            "uri": public_media_url(waiting[1].audio_file.url),
        })
        lines = services.export_offair_m3u()
        self.assertEqual(
            [line.split(",", 1)[1] for line in lines if line.startswith("#EXTINF:")],
            ["Waiting 3", "Waiting 1", "Waiting 2"],
        )


@override_settings(MEDIA_ROOT=MEDIA)
class OffAirRotationTests(APITestCase):
    def setUp(self):
        for i in (1, 2, 3):
            OffAirTrack.objects.create(title=f"Waiting {i}", audio_file=wav_upload(f"w{i}.wav"))

    def test_offair_m3u_starts_after_the_on_air_waiting_song(self):
        services.ingest_metadata({"kind": "music", "title": "Waiting 2", "duration_seconds": 0})
        lines = services.export_offair_m3u()
        self.assertEqual(
            [line.split(",", 1)[1] for line in lines if line.startswith("#EXTINF:")],
            ["Waiting 3", "Waiting 1", "Waiting 2"],
        )

    def test_offair_m3u_keeps_upload_order_without_an_anchor(self):
        lines = services.export_offair_m3u()
        self.assertEqual(
            [line.split(",", 1)[1] for line in lines if line.startswith("#EXTINF:")],
            ["Waiting 1", "Waiting 2", "Waiting 3"],
        )

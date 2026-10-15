# ---------------------------------------------------------------------------
# Aurora Radio — Liquidsoap 2.x broadcast script
#
# The station's single authoritative broadcast timeline. This script:
#   1. pulls the music rotation from the Django backend's M3U export
#   2. reports now-playing metadata (with UTC start instants) to Django
#   3. inserts scheduled audio ad breaks when the backend says a window is open
#   4. falls back to a local emergency file if the playlist can't provide
#   5. recovers automatically from source/network failures
#
# Environment (set in docker-compose):
#   BACKEND_URL     e.g. http://backend:8000
#   BROADCAST_KEY   shared secret, must match the backend's BROADCAST_API_KEY
#   ICECAST_HOST    e.g. icecast
#   ICECAST_PORT    e.g. 8000
#   ICECAST_PASSWORD source password
#   MOUNT           e.g. radio
#   FALLBACK_FILE   local emergency audio (generated as silent WAV at start)
# ---------------------------------------------------------------------------

settings.log.stdout := true
settings.log.level := 3

# Map playlist mime types to a file extension so procol.external can save
# the downloaded M3U; without this it logs an "unknown mime-type" warning
# on every playlist reload (the parse itself still works).
settings.http.mime.extnames := list.append(
  settings.http.mime.extnames(),
  [
    ("audio/x-mpegurl", ".m3u"),
    ("audio/mpegurl", ".m3u"),
    ("application/x-mpegurl", ".m3u")
  ]
)

BACKEND_URL = environment.get(default="http://backend:8000", "BACKEND_URL")
API_KEY     = environment.get(default="", "BROADCAST_KEY")
ICE_HOST    = environment.get(default="icecast", "ICECAST_HOST")
ICE_PORT    = int_of_string(default=8000, environment.get(default="8000", "ICECAST_PORT"))
ICE_PASS    = environment.get(default="", "ICECAST_PASSWORD")
MOUNT       = environment.get(default="radio", "MOUNT")
FALLBACK    = environment.get(default="/srv/radio/fallback/emergency.wav", "FALLBACK_FILE")

def auth_header() = [("X-Broadcast-Key", API_KEY)] end

# Metadata access raises when a key is missing — read it safely.
def meta_or(m, key, fallback) =
  try
    m[key]
  catch _ do
    fallback
  end
end

# ---------------------------------------------------------------------------
# 1. Music rotation from the backend
# ---------------------------------------------------------------------------
# Key in the query string: playlist() cannot send custom headers.
# mime_type skips the extension probe, which chokes on the query string.
music = playlist(
  mode="normal",
  reload=60,
  mime_type="audio/x-mpegurl",
  "#{BACKEND_URL}/api/internal/playlist.m3u?key=#{API_KEY}"
)

# Local emergency audio keeps the stream alive if the backend is unreachable.
emergency = single(FALLBACK)

# ---------------------------------------------------------------------------
# Broadcast on/off + off-air audio (driven by the backend heartbeat)
#
# The station toggle lives in the admin dashboard. The heartbeat response
# carries `broadcast_enabled` and the off-air track URL; while the broadcast
# is off the engine loops that track (or the local silence file) all day and
# never touches the music rotation. Turning the broadcast back on returns to
# the library at the next track boundary.
# ---------------------------------------------------------------------------
broadcast_on = ref(true)
offair_uri   = ref("")

def refresh_broadcast() =
  try
    body = http.post(
      "#{BACKEND_URL}/api/internal/heartbeat/",
      data = "{}",
      headers = list.append([("Content-Type", "application/json")], auth_header()),
      timeout = 5.
    )
    let json.parse ({broadcast_enabled, fallback_uri}: {broadcast_enabled: bool, fallback_uri: string}) = body
    broadcast_on := broadcast_enabled
    offair_uri := fallback_uri
  catch err do
    # Keep the last known mode on failure — never flip the station on a blip.
    log.important("broadcast poll failed: #{err}")
  end
end

thread.run(every=15., refresh_broadcast)

# Empty while on air (fallback moves on to the music rotation); a looping
# request while off air, so the off-audio plays all day.
def get_offair() =
  if broadcast_on() then
    []
  else
    uri = offair_uri()
    if uri == "" then
      [request.create(FALLBACK)]
    else
      [request.create(uri)]
    end
  end
end

offair = request.dynamic.list(get_offair)

# ---------------------------------------------------------------------------
# Force play ("Play now"): the admin picks a track in the dashboard and it
# interrupts the current item within seconds. The backend claims the request
# on the first successful poll, so it airs exactly once and the normal chain
# resumes after it. Ignored while the broadcast is off (the off-air loop
# keeps priority; the track airs after the broadcast is switched back on).
# ---------------------------------------------------------------------------
force_uri   = ref("")
force_active = ref(false)
force_seen   = ref("")

def refresh_force() =
  try
    body = http.get(
      "#{BACKEND_URL}/api/internal/force-play/",
      headers = auth_header(),
      timeout = 5.
    )
    let json.parse ({active}: {active: bool}) = body
    if active then
      let json.parse ({uri, requested_at}: {uri: string, requested_at: string}) = body
      if uri != "" and requested_at != force_seen() then
        force_seen := requested_at
        force_uri := uri
        force_active := true
        log.important("force-play queued: #{uri}")
      end
    end
  catch err do
    log.important("force-play poll failed: #{err}")
  end
end

thread.run(every=5., refresh_force)

# Consume-once: handing the request out clears the flag so the track airs a
# single time, then fallback moves back to off-air/music.
def get_force() =
  if force_active() and broadcast_on() then
    force_active := false
    [request.create(force_uri())]
  else
    []
  end
end

force = request.dynamic.list(prefetch=1, get_force)

# Broadcast gate: while off, loop the waiting track (the switch cuts away
# from it the instant the broadcast turns back on — no waiting for the loop
# file to finish). While on, straight to the music rotation.
offair_or_music = switch(track_sensitive=false, [
  ({not(broadcast_on())}, offair),
  ({true}, music)
])

radio = fallback(track_sensitive=false, [force, offair_or_music, emergency])

# ---------------------------------------------------------------------------
# 2. Now-playing metadata reporting
# ---------------------------------------------------------------------------
def post_now_playing(m) =
  payload = json.stringify({
    kind = "music",
    title = meta_or(m, "title", ""),
    artist = meta_or(m, "artist", ""),
    album = meta_or(m, "album", ""),
    duration_seconds = int(max(0., radio.duration())),
    started_at = time()  # engine wall-clock instant (UTC epoch seconds)
  })

  try
    ignore(http.post(
      "#{BACKEND_URL}/api/internal/ingest/",
      data = payload,
      headers = list.append([("Content-Type", "application/json")], auth_header()),
      timeout = 5.
    ))
  catch err do
    log.important("now-playing POST failed: #{err}")
  end
end

radio.on_metadata(post_now_playing)

# Liveness + broadcast mode: refresh_broadcast (above) posts the heartbeat
# every 15s and updates the on/off refs from the response.

# ---------------------------------------------------------------------------
# 3. Scheduled audio ad breaks
#
# The backend owns the schedule (recurrence, time zone, campaign windows).
# It answers "is a break open right now?" and "which adverts belong to it".
# ---------------------------------------------------------------------------
ad_active = ref(false)
# Advert ids in queue order: request.create cannot attach metadata in 2.3,
# so we track which advert each queued request corresponds to and pop one id
# per confirmation. The backend also matches by filename as a fallback.
ad_ids = ref([])
# Which break window the current queue belongs to (set on every fetch,
# reported back on confirmation so the backend confirms the exact row).
ad_schedule_id = ref("")

def refresh_ad_break() =
  try
    body = http.post(
      "#{BACKEND_URL}/api/internal/ad-break/",
      data = "{}",
      headers = list.append([("Content-Type", "application/json")], auth_header()),
      timeout = 5.
    )
    let json.parse ({active}: {active: bool}) = body
    ad_active := active
  catch err do
    # Never start a break on stale/failed data — keep playing music.
    ad_active := false
    log.important("ad-break poll failed: #{err}")
  end
end

thread.run(every=15., refresh_ad_break)

MAX_AD_SECONDS = 180.

def get_ads_for_break() =
  try
    body = http.post(
      "#{BACKEND_URL}/api/internal/ad-break/",
      data = "{}",
      headers = list.append([("Content-Type", "application/json")], auth_header()),
      timeout = 5.
    )
    # The backend returns {schedule_id, adverts: [{id, uri, duration, name}]}.
    let json.parse ({adverts, schedule_id}: {adverts: [{id: string, uri: string, duration: float}], schedule_id: string}) = body
    ad_schedule_id := schedule_id
    acc   = ref([])
    ids   = ref([])
    spent = ref(0.)
    list.iter(
      fun (ad) ->
        if spent() + ad.duration <= MAX_AD_SECONDS and ad.uri != "" then
          acc := list.append(acc(), [request.create(ad.uri)])
          ids := list.append(ids(), [ad.id])
          spent := spent() + ad.duration
        end,
      adverts
    )
    ad_ids := ids()
    acc()
  catch err do
    log.important("ad list fetch failed: #{err}")
    []
  end
end

ad_source = request.dynamic.list(get_ads_for_break)

def post_ad_played(m) =
  # Pop the next queued advert id — plays happen in queue order.
  pending = ad_ids()
  advert_id =
    if list.length(pending) > 0 then
      ad_ids := list.tl(pending)
      list.hd(pending)
    else
      ""
    end
  payload = json.stringify({
    advert_id = advert_id,
    schedule_id = ad_schedule_id(),
    filename = meta_or(m, "filename", ""),
    duration = int(max(0., ad_source.duration())),
    played_at = time()
  })
  try
    ignore(http.post(
      "#{BACKEND_URL}/api/internal/ad-played/",
      data = payload,
      headers = list.append([("Content-Type", "application/json")], auth_header()),
      timeout = 5.
    ))
  catch err do
    log.important("ad-played POST failed: #{err}")
  end
end

ad_source.on_metadata(post_ad_played)

# When a break is open, prefer ads; the moment the backend says it's over
# (or ads run out), fall straight back to the music.
ad_branch = fallback(track_sensitive=false, [ad_source, radio])

# Track-safe switching: the outer switch only changes source at track
# boundaries, so an opening break never cuts a song mid-play (documented
# "safe point" policy). Ads never air while the broadcast is off.
scheduled = switch(track_sensitive=true, [
  ({ad_active() and broadcast_on()}, ad_branch),
  ({true}, radio)
])

# Final safety net: if both scheduled and playlist fail, play the emergency file.
final = fallback(track_sensitive=false, [scheduled, emergency])

# ---------------------------------------------------------------------------
# 4. Output
# ---------------------------------------------------------------------------
output.icecast(
  %mp3(bitrate=128),  # MP3: plays in every browser (Safari can't decode Vorbis)
  host=ICE_HOST,
  port=ICE_PORT,
  password=ICE_PASS,
  mount=MOUNT,  # e.g. "radio" — must match STREAM_PUBLIC_URL's final segment and ICECAST_MOUNT
  name="Aurora Radio",
  description="Aurora Radio — one live stream, worldwide",
  url="https://auroraradio.example",
  final
)

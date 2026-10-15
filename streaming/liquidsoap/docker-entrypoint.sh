#!/bin/sh
set -eu

FALLBACK="${FALLBACK_FILE:-/srv/radio/fallback/emergency.wav}"

# Generate 60s of digital silence as a WAV if no fallback exists.
# A RIFF/WAV header followed by zero samples — no external tools needed.
if [ ! -s "$FALLBACK" ]; then
  mkdir -p "$(dirname "$FALLBACK")"
  RATE=8000
  SECONDS_LEN=60
  DATA_LEN=$((RATE * SECONDS_LEN * 2))  # 16-bit mono
  {
    printf 'RIFF'
    printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $(( (36 + DATA_LEN) & 255 )) $(( ((36 + DATA_LEN) >> 8) & 255 )) $(( ((36 + DATA_LEN) >> 16) & 255 )) 0)"
    printf 'WAVEfmt '
    printf '\020\000\000\000'          # fmt chunk size = 16
    printf '\001\000'                  # PCM
    printf '\001\000'                  # mono
    printf "$(printf '\\%03o\\%03o\\000\\000' $(( RATE & 255 )) $(( (RATE >> 8) & 255 )))"  # sample rate
    printf "$(printf '\\%03o\\%03o\\000\\000' $(( (RATE * 2) & 255 )) $(( ((RATE * 2) >> 8) & 255 )))"  # byte rate
    printf '\002\000'                  # block align
    printf '\020\000'                  # bits per sample = 16
    printf 'data'
    printf "$(printf '\\%03o\\%03o\\%03o\\000' $(( DATA_LEN & 255 )) $(( (DATA_LEN >> 8) & 255 )) $(( (DATA_LEN >> 16) & 255 )))"
    head -c "$DATA_LEN" /dev/zero
  } > "$FALLBACK"
  echo "generated silent fallback at $FALLBACK"
fi

# Validate the script before going live; fail fast on config errors.
liquidsoap --check /etc/liquidsoap/radio.liq

exec liquidsoap /etc/liquidsoap/radio.liq

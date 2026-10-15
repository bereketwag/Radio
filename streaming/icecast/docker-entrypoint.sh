#!/bin/sh
set -eu

# Substitute env vars into the Icecast config, then hand off to the daemon.
TEMPLATE="${ICECAST_TEMPLATE:-/etc/icecast2/icecast.xml.template}"
TARGET="/etc/icecast2/icecast.xml"

envsubst \
  '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD} ${ICECAST_HOSTNAME}' \
  < "$TEMPLATE" > "$TARGET"

mkdir -p /var/log/icecast2 /usr/share/icecast2/html
chown -R icecast:icecast /var/log/icecast2 /usr/share/icecast2 2>/dev/null || true

# Alpine's Icecast refuses to run as root and (in this build) also rejects the
# <changeowner> directive, so we drop privileges here instead.
exec su-exec icecast:icecast icecast -c "$TARGET"

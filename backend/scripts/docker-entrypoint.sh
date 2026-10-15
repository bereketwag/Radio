#!/bin/sh
set -eu

echo "applying migrations…"
python manage.py migrate --noinput

echo "collecting static…"
python manage.py collectstatic --noinput 2>/dev/null || true

if [ "${INIT_STATION:-false}" = "true" ]; then
  echo "ensuring the station admin account exists…"
  python manage.py init_station || true
fi

exec gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --threads "${GUNICORN_THREADS:-2}" \
  --timeout 120 \
  --access-logformat '%(h)s %(l)s %(u)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s' \
  --access-logfile - \
  --error-logfile -

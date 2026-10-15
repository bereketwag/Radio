FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# No compiler/libpq needed: requirements.txt pins psycopg[binary] (prebuilt
# wheel with bundled libpq) and every other dependency ships wheels or is
# pure Python. Skipping apt keeps the image smaller and the build offline-
# friendly.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

FROM alpine:3.20

RUN apk add --no-cache icecast envsubst gettext su-exec \
    && mkdir -p /var/log/icecast2 /usr/share/icecast2/html \
    && chown -R icecast:icecast /var/log/icecast2 /usr/share/icecast2

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY icecast.xml /etc/icecast2/icecast.xml.template
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

FROM savonet/liquidsoap:v2.3.1

USER root
COPY radio.liq /etc/liquidsoap/radio.liq
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /srv/radio/fallback \
    && chown -R liquidsoap:liquidsoap /srv/radio/fallback

USER liquidsoap
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

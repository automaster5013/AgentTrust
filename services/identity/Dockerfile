FROM quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244 AS build
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN apt-get update \
 && apt-get install --yes --no-install-recommends --only-upgrade curl=8.18.0-1ubuntu2.8 libcurl4t64=8.18.0-1ubuntu2.8 \
 && rm -rf /var/lib/apt/lists/*
RUN rm -f /usr/bin/pebble
COPY --from=build --chown=1000:1000 /opt/keycloak/ /opt/keycloak/
WORKDIR /opt/keycloak
ENV HOME=/opt/keycloak
SHELL ["/bin/bash", "-c"]
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
USER 1000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start","--optimized","--http-enabled=true","--hostname=http://127.0.0.1:4322","--import-realm"]

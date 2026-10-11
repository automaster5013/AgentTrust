FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ADD --checksum=sha256:44c1433b8c5e9638708e62644aa43a746f991206acef5889eaec620a895813b8 https://codeload.github.com/grafana/loki/tar.gz/09e6ce2ff1bdc19763a10265b870c86f51c98655 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS='-p=2 -mod=mod'
RUN go get golang.org/x/net@v0.60.0
RUN go build -trimpath -tags=netgo -ldflags='-s -w -X github.com/grafana/loki/v3/pkg/util/build.Version=3.7.8 -X github.com/grafana/loki/v3/pkg/util/build.Revision=09e6ce2ff1bdc19763a10265b870c86f51c98655 -X github.com/grafana/loki/v3/pkg/util/build.Branch=agenttrust-security-rebuild' -o /loki ./cmd/loki
COPY health.go /health.go
RUN go build -trimpath -ldflags='-s -w' -o /health /health.go
FROM grafana/loki:3.7.8@sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193
COPY --from=build /loki /usr/bin/loki
COPY --from=build /health /health
COPY --from=build /source/LICENSE /licenses/loki-AGPL-3.0.txt
USER 10001:10001
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 CMD ["/health", "loki"]

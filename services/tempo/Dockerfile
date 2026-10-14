FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ADD --checksum=sha256:a5489d155031677121f8e715791012bc96f1ecacf5b4bcaaee6eb6a902560156 https://codeload.github.com/grafana/tempo/tar.gz/77fc4563d1135d0ca2656709c7384c278a9c67b0 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS='-p=2 -mod=mod' GODEBUG=http2client=0
RUN go get golang.org/x/net@v0.60.0
RUN go build -trimpath -ldflags='-s -w -X main.Version=3.1.0 -X main.Revision=77fc4563d1135d0ca2656709c7384c278a9c67b0 -X main.Branch=agenttrust-security-rebuild' -o /tempo ./cmd/tempo
COPY health.go /health.go
RUN go build -trimpath -ldflags='-s -w' -o /health /health.go
FROM grafana/tempo:3.1.0@sha256:3076b8dcdfb32fd6bc5ccef85e7b7313e6199b9cb84366257fc17ecb696db5fd
COPY --from=build /tempo /tempo
COPY --from=build /health /health
COPY --from=build /source/LICENSE /licenses/tempo-AGPL-3.0.txt
USER 10001:10001
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 CMD ["/health", "tempo"]

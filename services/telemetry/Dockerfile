FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ADD --checksum=sha256:7c74640d726f23689d8853e0d5a55707ad8b524417ca7416c036c4ecb9ddb01f https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fbuilder%2Fv0.162.0/ocb_0.162.0_linux_amd64 /usr/local/bin/ocb
RUN chmod 755 /usr/local/bin/ocb
WORKDIR /build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS=-p=2 GODEBUG=http2client=0
COPY builder.yaml /build/builder.yaml
RUN ocb --config=/build/builder.yaml --skip-compilation
WORKDIR /build/collector
RUN go get golang.org/x/net@v0.60.0 google.golang.org/grpc@v1.83.2
RUN go test ./... && go build -trimpath -tags=grpcnotrace -ldflags='-s -w' -o /otelcol .
ADD --checksum=sha256:c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4 https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-releases/f6159a775dad1e21433c49bd8450673dd13ed4d3/LICENSE /licenses/opentelemetry-Apache-2.0.txt
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache ca-certificates
COPY --from=build /otelcol /otelcol
COPY --from=build /licenses /licenses
USER 10001:10001
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1:13133/
ENTRYPOINT ["/otelcol"]
CMD ["--config=/etc/otel/config.yaml"]

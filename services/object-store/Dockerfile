FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ADD --checksum=sha256:45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841 https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOFLAGS=-p=2
RUN go get github.com/apache/thrift@v0.24.0 github.com/buger/jsonparser@v1.1.2 github.com/go-jose/go-jose/v4@v4.1.4 github.com/prometheus/prometheus@v0.311.3 github.com/rabbitmq/amqp091-go@v1.13.0 go.opentelemetry.io/otel/sdk@v1.44.0 golang.org/x/crypto@v0.57.0 golang.org/x/net@v0.60.0 golang.org/x/text@v0.42.0 google.golang.org/grpc@v1.83.2
RUN go build -mod=mod -trimpath -ldflags='-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CommitID=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a -X github.com/minio/minio/cmd.ShortCommitID=9e49d5e7a648 -X github.com/minio/minio/cmd.CopyrightYear=2025' -o /minio .
COPY init /source/stack-init
RUN go build -mod=mod -trimpath -o /minio-init ./stack-init
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /minio-init /usr/local/bin/minio-init
COPY --from=build /source/LICENSE /usr/share/licenses/minio/LICENSE
USER 10001:10001
ENV MINIO_ROOT_USER_FILE=/run/secrets/stack-minio-root-user MINIO_ROOT_PASSWORD_FILE=/run/secrets/stack-minio-root-password MINIO_BROWSER=off MINIO_UPDATE=off
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1:9000/minio/health/ready
ENTRYPOINT ["minio"]
CMD ["server","/tmp/minio-data","--address",":9000","--console-address",":9001","--quiet"]

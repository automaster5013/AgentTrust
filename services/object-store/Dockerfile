FROM golang:1.26-alpine@sha256:c95332c2af86b6d89b91bd0500f4b9529ccbd090a0d1855c6d1ceaa142ae8615 AS build
ADD --checksum=sha256:45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841 https://codeload.github.com/minio/minio/tar.gz/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN go mod download
RUN go build -trimpath -ldflags='-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CommitID=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a -X github.com/minio/minio/cmd.ShortCommitID=9e49d5e7a648 -X github.com/minio/minio/cmd.CopyrightYear=2025' -o /minio .
COPY init /source/stack-init
RUN go build -trimpath -o /minio-init ./stack-init
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /minio-init /usr/local/bin/minio-init
COPY --from=build /source/LICENSE /usr/share/licenses/minio/LICENSE
USER 10001:10001
ENV MINIO_ROOT_USER_FILE=/run/secrets/stack-minio-root-user MINIO_ROOT_PASSWORD_FILE=/run/secrets/stack-minio-root-password MINIO_BROWSER=off MINIO_UPDATE=off
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 CMD wget -q -O /dev/null http://127.0.0.1:9000/minio/health/ready
ENTRYPOINT ["minio"]
CMD ["server","/tmp/minio-data","--address",":9000","--console-address",":9001","--quiet"]

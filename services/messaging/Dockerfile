FROM golang:1.27.3-alpine@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd AS compile
ADD --checksum=sha256:83e3ddd057e5c7aba76c34012cbd3e3c98e850061b307a39443331a857e8fcca https://codeload.github.com/nats-io/nats-server/tar.gz/d237c3be7f99cb45ef0809d6948c3882f4966adf /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=512MiB GODEBUG=http2client=0
RUN go build -p 2 -trimpath -ldflags='-s -w' -o /nats-server .
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache ca-certificates
COPY --from=compile /nats-server /nats-server
COPY --from=compile /source/LICENSE /licenses/nats-server-Apache-2.0.txt
USER 10001
ENTRYPOINT ["/nats-server"]

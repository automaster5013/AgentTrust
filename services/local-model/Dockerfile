FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS assets
RUN apk add --no-cache curl tar zstd
RUN test "$(uname -m)" = x86_64 && curl --fail --location --retry 2 -o /tmp/ollama.tar.zst https://github.com/ollama/ollama/releases/download/v0.40.2/ollama-linux-amd64.tar.zst && echo '726bee78706c281b0eeef00746efe51a044d71c592c3f0b195820707f31fdf04  /tmp/ollama.tar.zst' | sha256sum -c -
RUN mkdir /cpu && tar --wildcards --no-wildcards-match-slash -I zstd -xf /tmp/ollama.tar.zst -C /cpu bin/ollama 'lib/ollama/*.so*' lib/ollama/llama-server lib/ollama/GO_LICENSE && rm /tmp/ollama.tar.zst
RUN curl --fail --location -o /cpu/LICENSE https://raw.githubusercontent.com/ollama/ollama/v0.40.2/LICENSE && echo '5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226  /cpu/LICENSE' | sha256sum -c -
FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS compiler
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7 AS patched
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl build-essential && rm -rf /var/lib/apt/lists/*
COPY --from=compiler /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH GOTOOLCHAIN=local GOMAXPROCS=2 CGO_ENABLED=1
WORKDIR /source
RUN curl --fail --location --retry 2 -o /tmp/source.tar.gz https://codeload.github.com/ollama/ollama/tar.gz/b061384d90ff455462bc32745dd0de479de717a3 && echo '74a09e8de6139ae60504f4892a768ce57de4796c01d1fe0edcfc03bcacc4cb67  /tmp/source.tar.gz' | sha256sum -c - && tar -xzf /tmp/source.tar.gz --strip-components=1 && rm /tmp/source.tar.gz
RUN go get github.com/buger/jsonparser@v1.1.2 golang.org/x/crypto@v0.57.0 golang.org/x/image@v0.45.0 golang.org/x/mod@v0.41.0 golang.org/x/net@v0.60.0 golang.org/x/text@v0.42.0 && go mod tidy
RUN go build -p 2 -trimpath -buildmode=pie -ldflags='-s -w -X github.com/ollama/ollama/version.Version=0.40.2' -o /patched-ollama .
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libgomp1 && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --user-group --no-create-home model
RUN rm -f /usr/bin/pebble
COPY --from=patched /patched-ollama /usr/bin/ollama
COPY --from=assets /cpu/lib/ollama/ /usr/lib/ollama/
COPY --from=assets /cpu/LICENSE /licenses/ollama-MIT.txt
COPY --from=patched /source/go.mod /source/go.sum /licenses/patched-dependencies/
ENV HOME=/tmp OLLAMA_NO_CLOUD=true OLLAMA_NOPRUNE=true OLLAMA_DEBUG_LOG_REQUESTS=false OLLAMA_VULKAN=false
COPY model-sha256.txt model-entrypoint.sh /opt/agenttrust/
RUN chmod 0444 /opt/agenttrust/model-sha256.txt && chmod 0555 /opt/agenttrust/model-entrypoint.sh
USER 10001:10001
ENTRYPOINT ["/opt/agenttrust/model-entrypoint.sh"]
CMD ["serve"]

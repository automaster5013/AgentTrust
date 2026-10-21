FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS metadata
WORKDIR /policies
COPY policies ./
COPY policy-version.txt /policy-version.txt
RUN python -c "import hashlib,json,pathlib; p=json.loads(pathlib.Path('metadata.json').read_text())['agenttrust']['policy']; assert p['digest']=='sha256:'+hashlib.sha256(pathlib.Path('release.rego').read_bytes()).hexdigest(); assert p['version']==pathlib.Path('/policy-version.txt').read_text().strip()"
FROM golang:1.27.3-alpine@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd AS compile
ADD --checksum=sha256:9ae68d49dc4ba61da41b5944c3e612e7973f6e6afd74ebafe585e7ed177e35bb https://codeload.github.com/open-policy-agent/opa/tar.gz/2a109e54103370d2ef288782ef3cb4c8a37902b2 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GODEBUG=http2client=0
RUN go mod edit -require=golang.org/x/net@v0.60.0 && go mod tidy
RUN go build -mod=mod -trimpath -tags=opa_no_wasm -ldflags='-s -w -X github.com/open-policy-agent/opa/version.Version=1.21.1' -o /opa .
FROM scratch AS test
COPY --from=compile /opa /opa
COPY --from=metadata /policies /policies
RUN ["/opa","check","--strict","/policies"]
RUN ["/opa","test","--fail-on-empty","/policies"]
FROM scratch
COPY --from=compile /opa /opa
COPY --from=compile /source/LICENSE /usr/share/licenses/opa/LICENSE
COPY --from=test /policies/release.rego /policies/release.rego
COPY --from=test /policies/authz.rego /policies/authz.rego
COPY --from=test /policies/metadata.json /policies/metadata.json
USER 10001
ENTRYPOINT ["/opa"]
CMD ["run","--server","--addr=0.0.0.0:8181","--authentication=token","--authorization=basic","--skip-version-check","--log-level=error","/policies","/run/secrets/stack-opa-auth.json"]

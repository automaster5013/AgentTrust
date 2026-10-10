FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS metadata
WORKDIR /policies
COPY policies ./
COPY policy-version.txt /policy-version.txt
RUN python -c "import hashlib,json,pathlib; p=json.loads(pathlib.Path('metadata.json').read_text())['agenttrust']['policy']; assert p['digest']=='sha256:'+hashlib.sha256(pathlib.Path('release.rego').read_bytes()).hexdigest(); assert p['version']==pathlib.Path('/policy-version.txt').read_text().strip()"
FROM openpolicyagent/opa:1.21.1-static@sha256:4675ab04ad1627f74741d2d9c5142698c79e18b7b09f192587d31d6dba20838e AS test
COPY --from=metadata /policies /policies
RUN ["/opa","check","--strict","/policies"]
RUN ["/opa","test","--fail-on-empty","/policies"]
FROM openpolicyagent/opa:1.21.1-static@sha256:4675ab04ad1627f74741d2d9c5142698c79e18b7b09f192587d31d6dba20838e
COPY --from=test /policies/release.rego /policies/release.rego
COPY --from=test /policies/authz.rego /policies/authz.rego
COPY --from=test /policies/metadata.json /policies/metadata.json
USER 10001
CMD ["run","--server","--addr=0.0.0.0:8181","--authentication=token","--authorization=basic","--skip-version-check","--log-level=error","/policies","/run/secrets/stack-opa-auth.json"]

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS binaries
ADD --checksum=sha256:c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_Linux-64bit.tar.gz /trivy.tar.gz
ADD --checksum=sha256:c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47 https://github.com/anchore/syft/releases/download/v1.54.1/syft_1.54.1_linux_amd64.tar.gz /syft.tar.gz
ADD --checksum=sha256:551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz /gitleaks.tar.gz
ADD --checksum=sha256:4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71 https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64 /bin/cosign
RUN tar -xzf /trivy.tar.gz -C /bin trivy && tar -xzf /syft.tar.gz -C /bin syft && tar -xzf /gitleaks.tar.gz -C /bin gitleaks && chmod 755 /bin/cosign
FROM semgrep/semgrep:1.180.0@sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3
COPY --from=binaries /bin/trivy /bin/syft /bin/gitleaks /bin/cosign /usr/local/bin/
ENV SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SETTINGS_FILE=/tmp/semgrep-settings.yml SEMGREP_LOG_FILE=/tmp/semgrep.log SYFT_CHECK_FOR_APP_UPDATE=false
USER 10001:10001
ENTRYPOINT []
CMD ["trivy","--version"]

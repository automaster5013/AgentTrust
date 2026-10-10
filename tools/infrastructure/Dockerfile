FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72
RUN apk add --no-cache curl unzip && pip install --no-cache-dir PyYAML==6.0.3 && adduser -D -H -u 10001 verifier
RUN test "$(uname -m)" = x86_64 && curl --fail --location --retry 2 -o /tmp/helm.tar.gz https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz && echo '86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb  /tmp/helm.tar.gz' | sha256sum -c - && tar -xzf /tmp/helm.tar.gz -C /tmp && cp /tmp/linux-amd64/helm /usr/local/bin/helm
RUN curl --fail --location --retry 2 -o /tmp/terraform.zip https://releases.hashicorp.com/terraform/1.16.5/terraform_1.16.5_linux_amd64.zip && echo '2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4  /tmp/terraform.zip' | sha256sum -c - && unzip /tmp/terraform.zip -d /usr/local/bin
RUN curl --fail --location --retry 2 -o /tmp/kubeconform.tar.gz https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz && echo '9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883  /tmp/kubeconform.tar.gz' | sha256sum -c - && tar -xzf /tmp/kubeconform.tar.gz -C /usr/local/bin kubeconform && rm /tmp/helm.tar.gz /tmp/terraform.zip /tmp/kubeconform.tar.gz
ENV HOME=/tmp TF_IN_AUTOMATION=1 CHECKPOINT_DISABLE=1 HELM_CACHE_HOME=/tmp/helm/cache HELM_CONFIG_HOME=/tmp/helm/config HELM_DATA_HOME=/tmp/helm/data
USER 10001
WORKDIR /work

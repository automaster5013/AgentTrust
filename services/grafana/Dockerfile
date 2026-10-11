FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
RUN apk add --no-cache bash make git
ADD --checksum=sha256:8e31ab62f206cc2d4964373bf0c3502793210aba50a11cc3ff2f0db790cedab0 https://codeload.github.com/grafana/grafana/tar.gz/refs/tags/v13.2.3 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=1536MiB GOFLAGS='-p=2' COMMIT_SHA=6193dc03311b631b9727b560d24369e683dc396e BUILD_BRANCH=agenttrust-security-rebuild
RUN go work edit -replace=golang.org/x/net=golang.org/x/net@v0.60.0 \
    && go work edit -replace=google.golang.org/grpc=google.golang.org/grpc@v1.83.2
RUN make build-go GO_BUILD_TAGS=oss WIRE_TAGS=oss

FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72 AS plugins
WORKDIR /packages
ADD --checksum=sha256:abda2fe09dc33779e9e2328601a89c357193dc7086b75866f02f7929ff174399 https://grafana.com/api/plugins/elasticsearch/versions/12.9.2/download?os=linux&arch=amd64 /packages/elasticsearch.zip
ADD --checksum=sha256:d34f44bd13213502de4394955fcc170d70fb822531c181bff0179f216c35a0e0 https://grafana.com/api/plugins/grafana-postgresql-datasource/versions/13.0.4/download?os=linux&arch=amd64 /packages/grafana-postgresql-datasource.zip
ADD --checksum=sha256:397266357522001d19433d3b77c49f6bbf2210aea5e2a8d51bedb93ebc74b773 https://grafana.com/api/plugins/grafana-pyroscope-datasource/versions/13.0.7/download?os=linux&arch=amd64 /packages/grafana-pyroscope-datasource.zip
ADD --checksum=sha256:640a19f8494d41b2d4f12b10670348506698fd3b0a5ac9e32e9601cb65b40897 https://grafana.com/api/plugins/influxdb/versions/13.1.7/download?os=linux&arch=amd64 /packages/influxdb.zip
ADD --checksum=sha256:dc57642e289ba81a2dd7179b0f7e945966f5db1234c7aaf9e470a2db34207ce1 https://grafana.com/api/plugins/jaeger/versions/13.0.5/download?os=linux&arch=amd64 /packages/jaeger.zip
ADD --checksum=sha256:0d1f5794d34febc54e55ac05ac92ea4ad6548ec3f2521865116c9ed46f7d55e9 https://grafana.com/api/plugins/loki/versions/13.2.2/download?os=linux&arch=amd64 /packages/loki.zip
ADD --checksum=sha256:4c7482151acda930ff35b45bafa0d90ec8636c8f92350a20a287496bf7e202b0 https://grafana.com/api/plugins/mssql/versions/13.0.7/download?os=linux&arch=amd64 /packages/mssql.zip
ADD --checksum=sha256:70ad88d3a304c677ef59603adb644ff9958d3abaae773793b8710d69651845c6 https://grafana.com/api/plugins/mysql/versions/13.1.4/download?os=linux&arch=amd64 /packages/mysql.zip
ADD --checksum=sha256:5fbe65a810453d7edc40e968fb3e19f1114d17d82401c4806727eee5b2f7f612 https://grafana.com/api/plugins/opentsdb/versions/13.0.4/download?os=linux&arch=amd64 /packages/opentsdb.zip
ADD --checksum=sha256:8bdd6583e398f84d497dabec0287563b9eee471d711dea08a21482db5cd5a294 https://grafana.com/api/plugins/prometheus/versions/13.2.3/download?os=linux&arch=amd64 /packages/prometheus.zip
ADD --checksum=sha256:4792fb5705567b03dc0089db1bd688fbc541f9b8bb47e40488b7b6a32a19bf5a https://grafana.com/api/plugins/stackdriver/versions/12.6.2/download?os=linux&arch=amd64 /packages/stackdriver.zip
ADD --checksum=sha256:a89fa4ee83a61e58dac30eae3ce42ae6f677545d05e419b88f0a6f5f6cfdf8e7 https://grafana.com/api/plugins/tempo/versions/13.2.4/download?os=linux&arch=amd64 /packages/tempo.zip
ADD --checksum=sha256:94e67f5f4236925282a88a4cf7407582310fd4efa77cde1a67252e57fbd63b15 https://grafana.com/api/plugins/zipkin/versions/12.4.9/download?os=linux&arch=amd64 /packages/zipkin.zip
COPY plugins.lock.json unpack-plugins.py /packages/
RUN python unpack-plugins.py
FROM grafana/grafana:13.2.3@sha256:b28bae15e219c998fb0e0424ed724930cc61b1f61fb404d47c862f9a23f9e572
USER root
RUN rm -rf /usr/share/grafana/data/plugins-bundled/elasticsearch /usr/share/grafana/data/plugins-bundled/grafana-postgresql-datasource /usr/share/grafana/data/plugins-bundled/grafana-pyroscope-datasource /usr/share/grafana/data/plugins-bundled/influxdb /usr/share/grafana/data/plugins-bundled/jaeger /usr/share/grafana/data/plugins-bundled/loki /usr/share/grafana/data/plugins-bundled/mssql /usr/share/grafana/data/plugins-bundled/mysql /usr/share/grafana/data/plugins-bundled/opentsdb /usr/share/grafana/data/plugins-bundled/prometheus /usr/share/grafana/data/plugins-bundled/stackdriver /usr/share/grafana/data/plugins-bundled/tempo /usr/share/grafana/data/plugins-bundled/zipkin
COPY --from=plugins --chown=472:0 /plugins/ /usr/share/grafana/data/plugins-bundled/
COPY --from=build /source/bin/linux/amd64/grafana /usr/share/grafana/bin/grafana
USER 472:0

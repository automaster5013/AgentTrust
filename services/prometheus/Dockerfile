FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS ui
RUN apk add --no-cache bash make gzip
ADD --checksum=sha256:eb57341b8b54fddaeededb15dbb77cc30a11750cecca301bfda02478fdff3a00 https://registry.npmjs.org/pnpm/-/pnpm-12.11.2.tgz /pnpm.tar.gz
RUN mkdir /pnpm && tar -xzf /pnpm.tar.gz --strip-components=1 -C /pnpm && ln -s /pnpm/bin/pnpm.cjs /usr/local/bin/pnpm
ADD --checksum=sha256:eee7ec029ffdba7d9ee59171cad5ddaff10e71514b0bae1a6fde6dc1ae99e181 https://codeload.github.com/prometheus/prometheus/tar.gz/5241a27fe3c6983549fccc32f6e65917408c63cd /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
WORKDIR /source/web/ui
RUN pnpm install --frozen-lockfile && cd react-app && pnpm install --frozen-lockfile
RUN pnpm run build
WORKDIR /source
RUN bash scripts/compress_assets.sh

FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
ADD --checksum=sha256:eee7ec029ffdba7d9ee59171cad5ddaff10e71514b0bae1a6fde6dc1ae99e181 https://codeload.github.com/prometheus/prometheus/tar.gz/5241a27fe3c6983549fccc32f6e65917408c63cd /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz --strip-components=1 -C /source
COPY --from=ui /source/web/ui/static /source/web/ui/static
COPY --from=ui /source/web/ui/embed.go /source/web/ui/embed.go
WORKDIR /source
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS='-p=2 -mod=mod' GOWORK=off
RUN go get golang.org/x/net@v0.60.0
RUN go build -trimpath -tags=netgo,builtinassets -ldflags='-s -w -X github.com/prometheus/common/version.Version=3.15.0 -X github.com/prometheus/common/version.Revision=5241a27fe3c6983549fccc32f6e65917408c63cd -X github.com/prometheus/common/version.Branch=agenttrust-security-rebuild' -o /prometheus ./cmd/prometheus \
    && go build -trimpath -tags=netgo,builtinassets -ldflags='-s -w -X github.com/prometheus/common/version.Version=3.15.0 -X github.com/prometheus/common/version.Revision=5241a27fe3c6983549fccc32f6e65917408c63cd -X github.com/prometheus/common/version.Branch=agenttrust-security-rebuild' -o /promtool ./cmd/promtool
FROM prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e
COPY --from=build /prometheus /bin/prometheus
COPY --from=build /promtool /bin/promtool
COPY --from=build /source/LICENSE /licenses/prometheus-Apache-2.0.txt
COPY --from=build /source/NOTICE /licenses/prometheus-NOTICE.txt
USER 10001:10001

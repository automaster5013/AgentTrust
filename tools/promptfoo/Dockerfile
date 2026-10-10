FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=optional
COPY *.mjs ./
RUN npm test
ENV PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_CACHE_ENABLED=false PROMPTFOO_CONFIG_DIR=/tmp/promptfoo LOG_LEVEL=error CI=1
USER node
CMD ["node","evaluate.mjs"]

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=optional
ENV PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_CACHE_ENABLED=false PROMPTFOO_CONFIG_DIR=/tmp/promptfoo LOG_LEVEL=error CI=1
COPY quality-policy.mjs quality-policy.spec.mjs quality-server.mjs quality-server.spec.mjs ./
RUN --network=none node --test quality-policy.spec.mjs quality-server.spec.mjs
RUN npm audit --omit=optional --audit-level=high
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=test --chown=node:node /app/node_modules ./node_modules
COPY --from=test --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=test --chown=node:node /app/quality-policy.mjs ./quality-policy.mjs
COPY --from=test --chown=node:node /app/quality-server.mjs ./quality-server.mjs
ENV PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_CACHE_ENABLED=false PROMPTFOO_CONFIG_DIR=/tmp/promptfoo LOG_LEVEL=error CI=1
USER node
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:9105/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","quality-server.mjs"]

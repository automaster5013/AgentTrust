FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run typecheck && npm test
ARG NEXT_PUBLIC_STACK_OIDC_PROFILE=local-review
ARG NEXT_PUBLIC_STACK_APPLICATION_ORIGIN=http://127.0.0.1:4320
ARG NEXT_PUBLIC_STACK_PUBLIC_ISSUER=http://127.0.0.1:4322/realms/agenttrust
ENV NEXT_PUBLIC_STACK_OIDC_PROFILE=$NEXT_PUBLIC_STACK_OIDC_PROFILE NEXT_PUBLIC_STACK_APPLICATION_ORIGIN=$NEXT_PUBLIC_STACK_APPLICATION_ORIGIN NEXT_PUBLIC_STACK_PUBLIC_ISSUER=$NEXT_PUBLIC_STACK_PUBLIC_ISSUER
RUN node --experimental-strip-types -e "import('./src/lib/oidc-endpoints.ts').then(m=>m.configuredOidcEndpoints())" && npm run build
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG NEXT_PUBLIC_STACK_OIDC_PROFILE=local-review
ARG NEXT_PUBLIC_STACK_APPLICATION_ORIGIN=http://127.0.0.1:4320
ARG NEXT_PUBLIC_STACK_PUBLIC_ISSUER=http://127.0.0.1:4322/realms/agenttrust
LABEL dev.agenttrust.oidc.profile=$NEXT_PUBLIC_STACK_OIDC_PROFILE dev.agenttrust.oidc.application-origin=$NEXT_PUBLIC_STACK_APPLICATION_ORIGIN dev.agenttrust.oidc.public-issuer=$NEXT_PUBLIC_STACK_PUBLIC_ISSUER
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node image-entry.mjs ./image-entry.mjs
RUN node -e "require('fs').writeFileSync('/app/oidc-image-config.json',JSON.stringify({profile:process.argv[1],applicationOrigin:process.argv[2],publicIssuer:process.argv[3]}))" "$NEXT_PUBLIC_STACK_OIDC_PROFILE" "$NEXT_PUBLIC_STACK_APPLICATION_ORIGIN" "$NEXT_PUBLIC_STACK_PUBLIC_ISSUER"
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","image-entry.mjs"]

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
COPY scripts/portfolio-offline.mjs scripts/check-connector-contract.mjs ./scripts/
USER node
CMD ["node", "apps/api/server.js"]

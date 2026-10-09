FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
COPY scripts/portfolio-offline.mjs scripts/check-connector-contract.mjs scripts/inspect-receipt.mjs scripts/verify-receipt.mjs scripts/trusted-receipt-key.mjs scripts/inspect-portfolio-evidence.mjs scripts/portfolio-evidence-inspection.mjs scripts/portfolio-evidence.mjs scripts/demo-review-binding.mjs scripts/inspect-operations-observation.mjs scripts/write-operations-observation-report.mjs scripts/compare-operations-observations.mjs scripts/write-operations-comparison-report.mjs ./scripts/
USER node
CMD ["node", "apps/api/server.js"]

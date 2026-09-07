# PharmaZs frontend — Next.js 15 (standalone output)
#
# NEXT_PUBLIC_* values are inlined into the client bundle AT BUILD TIME, so the
# API URL is a build ARG, not a runtime env var. An already-built image cannot
# be re-pointed at a different API — rebuild it.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
ARG NEXT_PUBLIC_USE_MOCKS=0
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_USE_MOCKS=$NEXT_PUBLIC_USE_MOCKS

# The production build is memory-hungry — same ceiling used for local builds.
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini

# next.config.ts sets output:"standalone", so .next/standalone contains server.js
# plus exactly the traced node_modules. Static assets are not included in the
# trace and must be copied alongside it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER node

# The standalone server reads HOSTNAME and PORT. All interfaces is required in a
# container; the npm start script keeps its loopback default for local runs.
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

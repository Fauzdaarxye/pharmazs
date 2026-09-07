# PharmaZs API — Node/Express + TypeScript
#
# Two stages: the build stage carries devDependencies (typescript) and compiles
# src -> dist; the runtime stage installs production deps only.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini reaps zombies and forwards SIGTERM, which the graceful shutdown in
# src/server.ts depends on to close the MySQL pool before exit.
RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run unprivileged. The node image ships a `node` user (uid 1000).
USER node

# config.ts reads PORT; app.listen binds all interfaces inside the container.
ENV PORT=4000
EXPOSE 4000

# NOTE: no .env is baked in. config.ts refuses to boot under
# NODE_ENV=production unless JWT_ACCESS_SECRET, DB_*, ML_BASE_URL and
# CORS_ORIGINS are supplied as real environment variables.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

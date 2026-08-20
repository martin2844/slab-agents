# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build \
  && test ! -e .data/slab-workspace.db

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3009 \
  SLAB_WORKSPACE_DB=/data/slab-workspace.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 slab \
  && useradd --uid 10001 --gid slab --system --home-dir /app --shell /usr/sbin/nologin slab \
  && mkdir -p /data \
  && chown slab:slab /data

COPY --from=production-dependencies --chown=slab:slab /app/node_modules ./node_modules
COPY --from=builder --chown=slab:slab /app/.next/standalone ./
COPY --from=builder --chown=slab:slab /app/.next/static ./.next/static
COPY --from=builder --chown=slab:slab /app/public ./public
COPY --chown=slab:slab package.json package-lock.json knexfile.cjs ./
COPY --chown=slab:slab db ./db
COPY --chown=slab:slab scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh
COPY --chown=slab:slab scripts/admin-bootstrap.mjs ./scripts/admin-bootstrap.mjs
COPY --chown=slab:slab lib/auth/password.mjs ./lib/auth/password.mjs

USER slab
EXPOSE 3009
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3009/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["dumb-init", "--", "/app/scripts/container-entrypoint.sh"]

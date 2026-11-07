# Production image. Also the image referenced by tinfoil-config.yml.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN useradd --uid 10001 --create-home app && mkdir -p /data && chown app /data
COPY --from=build --chown=app /app/.next/standalone ./
COPY --from=build --chown=app /app/.next/static ./.next/static
USER app
EXPOSE 8080
CMD ["node", "server.js"]

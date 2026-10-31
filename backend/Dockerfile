# Build context: repository root (the backend imports the root agent from ../../../src).
# Image layout mirrors the repo so relative imports resolve:
#   /app/package.json, /app/node_modules, /app/src          (root Dexter agent)
#   /app/backend/package.json, /app/backend/node_modules, /app/backend/src
FROM oven/bun:1 AS base
WORKDIR /app

# Production dependencies for both packages
FROM base AS install
COPY package.json bun.lock /temp/root/
# --ignore-scripts skips the root postinstall Chromium download: the browser tool is
# disabled when running under the web backend (DEXTER_WEB_MODE=1)
RUN cd /temp/root && bun install --frozen-lockfile --production --ignore-scripts
COPY backend/package.json backend/bun.lock /temp/backend/
RUN cd /temp/backend && bun install --frozen-lockfile --production

# Final production image
FROM base AS release
COPY --from=install /temp/root/node_modules ./node_modules
COPY --from=install /temp/backend/node_modules ./backend/node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY backend/package.json backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

WORKDIR /app/backend

# The code is root-owned and read-only for the runtime user; agent runs write their
# scratchpads and API cache here instead (mount a volume to keep them across restarts)
ENV DEXTER_DATA_DIR=/app/backend/.dexter
RUN mkdir -p "$DEXTER_DATA_DIR" && chown bun:bun "$DEXTER_DATA_DIR"

EXPOSE 8000

ENV NODE_ENV=production
ENV PORT=8000
ENV DEXTER_WEB_MODE=1

USER bun
CMD ["bun", "run", "start"]

# Use Bun official image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install production dependencies only
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy source code
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Final production image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /app/src ./src
COPY --from=prerelease /app/package.json .

# Expose port
EXPOSE 8000

# Set environment
ENV NODE_ENV=production
ENV PORT=8000

# Start server
USER bun
CMD ["bun", "run", "start"]

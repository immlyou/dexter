#!/bin/sh
# Apply pending database migrations, then start the API.
# Set RUN_MIGRATIONS=0 when migrations are applied separately (e.g. several replicas).
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  bun src/db/migrate.ts
fi

exec bun src/server.ts

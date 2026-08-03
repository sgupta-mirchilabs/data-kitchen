#!/bin/bash
#
# Azure App Service startup command.
#
# Applies pending Prisma migrations, then starts the API. The two run in strict
# sequence: if the migration fails, `set -e` aborts before `node dist/index.js`,
# so the container never binds a port and App Service never routes traffic to
# it. The previously deployed revision keeps serving.
#
# Migrations run here rather than in GitHub Actions because PostgreSQL denies
# all traffic except the App Service outbound IPs (see AZURE_INFRASTRUCTURE.md
# section 9.2.1). CI holds no database credentials.
#
# Failure is intentionally not auto-remediated. There is no rollback, no
# `migrate reset`, and no data deletion — see section 11.5 for the manual
# procedure.

set -euo pipefail

cd /home/site/wwwroot

echo "[startup] $(date -u +%Y-%m-%dT%H:%M:%SZ) Ensuring Prisma client is present..."
# Kudu zip deploy can strip dot-prefixed directories, which drops the generated
# client at node_modules/.prisma. Regenerating is a no-op when it survived.
npx prisma generate

echo "[startup] $(date -u +%Y-%m-%dT%H:%M:%SZ) Applying database migrations..."
npx prisma migrate deploy

echo "[startup] $(date -u +%Y-%m-%dT%H:%M:%SZ) Migrations applied. Starting API..."
exec node dist/index.js

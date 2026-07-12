#!/usr/bin/env bash
set -euo pipefail
pnpm check:fast
pnpm build
pnpm ai:index:check
echo "Fast validation and production build passed. Run pnpm test:e2e for browser checks."

#!/usr/bin/env bash
set -euo pipefail
pnpm check:fast
pnpm build
echo "Fast validation, workflow policy, and production build passed. Run pnpm check:all for final browser validation."

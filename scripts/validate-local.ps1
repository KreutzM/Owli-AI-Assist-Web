$ErrorActionPreference = "Stop"
pnpm check:fast
pnpm build
pnpm ai:index:check
Write-Host "Fast validation and production build passed. Run pnpm test:e2e for browser checks."

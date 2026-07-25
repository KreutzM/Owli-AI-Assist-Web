$ErrorActionPreference = "Stop"
pnpm check:fast
pnpm build
Write-Host "Fast validation, workflow policy, and production build passed. Run pnpm check:all for final browser validation."

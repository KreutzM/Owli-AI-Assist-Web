$ErrorActionPreference = "Stop"
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
Write-Host "Owli-AI Assist Web development environment is ready."

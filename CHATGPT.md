# Owli-AI Assist Web Assistant Guide

This is the stable starting point for repository-assistant work in the Owli-AI Assist web/PWA repository.

## Repository role

`KreutzM/Owli-AI-Assist-Web` owns the browser client and is checked out as `web/` inside `KreutzM/Owli-AI-Assist-WS`.

The web client owns browser camera integration, client-side image preparation, accessible UI state, PWA installation, browser speech/share adapters, and typed consumption of the shared Owli backend API. It does not own provider selection, prompt text, quotas, authentication policy, music generation, or video rendering.

## Start here

1. Read this file.
2. Read `AGENTS.md` for mandatory workflow and quality rules.
3. Read `docs/REPO_MAP.md`.
4. Read `.ai/web-guide.md` and `.ai/change-type-map.md`.
5. Read `docs/ARCHITECTURE.md` and `docs/ACCESSIBILITY.md` for UI or platform work.
6. For API or cross-stack changes, start in `KreutzM/Owli-AI-Assist-WS` and read `docs/API_CONTRACT.md` before editing.
7. For GitHub-connector work, follow `docs/GITHUB-CONNECTOR-SAFETY.md`.

## Source of truth

- Cross-stack contracts: workspace `docs/API_CONTRACT.md` plus current backend and client code.
- VLM profiles, prompts, model selection, quota enforcement, and feature rollout: backend.
- Browser capabilities and accessible interaction behavior: this repository.
- Marketing copy and search visibility: `KreutzM/owli-ai-landing`, not this repository.

## Work model

- Use a tracking issue for a multi-PR track and one child issue per implementation slice.
- Plan and review normally use `gpt-5.7-sol` through the OpenAI web interface and GitHub connector.
- Routine implementation defaults to `gpt-5.6-luna`; use `gpt-5.6-terra` for architecture-heavy, camera, streaming, concurrency, or security-sensitive work.
- Work on thematic branches, keep PRs small, and do not merge without explicit maintainer/orchestrator instruction.
- Persist Builder and Reviewer handoffs in the PR conversation.

## Current starter status

The repository includes a working mock-mode vertical slice. Remote mode intentionally depends on backend follow-up work for `platform: "web"`, CORS, rate-limit response details, and server-side video export.

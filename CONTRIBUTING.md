# Contributing

Use the Planner / Builder / Reviewer workflow documented in `docs/AGENT-HANDOFF-WORKFLOW.md`.

## Local gate

```bash
pnpm check:all
```

A PR should remain small, close one child issue, include tests for changed behavior, update affected docs, and identify manual iPhone/VoiceOver checks that CI cannot perform.

## Branch and commit examples

- Branch: `web/slice-2-scene-streaming`
- Commit: `api: add POST SSE scene transport`

Do not include provider keys, Cloudflare tokens, user images, generated Audio-Postcards, or production diagnostics in commits or PR comments.

# Model Role Policy

## OpenAI web-interface roles

- `gpt-5.6-sol` is normally used for Planner and Reviewer work in the OpenAI web interface with the GitHub connector.
- This web-interface choice is intentionally **not** stored as a model value in `.codex/*.toml`.
- Planner and Reviewer remain read-only by role unless the maintainer explicitly requests a narrow repository metadata action.

## Repository-local Codex roles

- `gpt-5.4` is the current default for local Codex runs and every checked-in sub-agent, matching the Assist and Backend repositories.
- `gpt-5.4-mini` may be used through the `quick` profile for narrow low-risk tasks.
- Use medium reasoning for routine implementation and high reasoning for architecture, camera APIs, SSE, concurrency, security, cross-layer refactors, and review.
- Do not migrate only the Web repository to a newer model family. Perform model-family changes later as one coordinated workspace-wide change.

The issue and PR remain the durable source of scope and handoff information. Model prompts are transport, not the only record of requirements.

A Builder must not approve its own work. A Reviewer must not implement extra features in the review PR. The maintainer/orchestrator decides merges.

If an intended model is unavailable, do not substitute silently: state the actual model in the Builder handoff or Reviewer result and assess whether a fresh review is needed.

# Model Role Policy

## Normal roles

- `gpt-5.7-sol`: Planner and Reviewer in the OpenAI web interface with GitHub connector. Read-only by role unless the maintainer explicitly requests a narrow metadata action.
- `gpt-5.6-luna`: default Builder for focused implementation and tests.
- `gpt-5.6-terra`: Builder/architect for camera APIs, SSE, concurrency, security, cross-layer refactors, or difficult failures.

The issue and PR remain the durable source of scope and handoff information. Model prompts are transport, not the only record of requirements.

A Builder must not approve its own work. A Reviewer must not implement extra features in the review PR. The maintainer/orchestrator decides merges.

If a configured model alias is unavailable, stop silent substitution: state the actual model in the Builder handoff or Reviewer result and assess whether a fresh review is needed.

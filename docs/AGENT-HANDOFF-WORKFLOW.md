# Agent Handoff Workflow

GitHub is the durable handoff layer.

- Tracking issue: overall objective, phases, decisions, and child links.
- Child issue: one small implementation cycle with scope, non-goals, acceptance criteria, and reviewer focus.
- PR: implementation that closes the child issue and references the tracking issue.

## Planner

Plans without editing code. Defines narrow scope, non-goals, acceptance criteria, affected repositories, required checks, and manual accessibility gates.

## Builder

Reads issues and repository instructions, acquires a verified local clone or exact-head bundle, creates a thematic branch/worktree, and prepares the complete logical patch locally. Formatting, relevant tests, generated artifacts, and diff review happen before the feature-branch ref moves. Normal Git push is preferred; the atomic Git Data API fallback is documented in `docs/AGENT-REPOSITORY-WORKFLOW.md`.

The Builder opens a draft PR and posts a top-level `## Builder handoff` comment containing branch, base, exact head, commits, files, local and CI checks, trigger matrix, bundle/atomic-publication evidence, risks, and reviewer focus.

## Reviewer

Reads the complete durable context, checks diff and CI against acceptance criteria, and records `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. The Reviewer does not merge by default.

## PR description

```md
## Summary

- ...

## Related Issue

Closes #<child>
Part of #<tracking>

## Behavior impact

- ...

## API / accessibility / privacy impact

- ...

## Checks

- ...

## Notes for Reviewer

- ...
```

## Merge gate

- PR is not draft.
- Final exact-head CI is green or an explicit exception exists.
- Scope matches the child issue.
- Builder handoff is present.
- Reviewer result is persisted in GitHub.
- No blocking findings remain.
- Maintainer/orchestrator explicitly approves merge.

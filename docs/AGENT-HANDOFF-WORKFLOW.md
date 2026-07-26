# Agent Handoff Workflow

GitHub is the durable handoff layer.

- Tracking issue: overall objective, phases, decisions, and child links.
- Child issue: one small implementation cycle with scope, non-goals, acceptance criteria, and reviewer focus.
- PR: implementation that closes the child issue and references the tracking issue.

## Planner

Plans without editing code. Defines narrow scope, non-goals, acceptance criteria, affected repositories, required checks, and manual accessibility gates.

## Builder

Reads issues and repository instructions, resolves the exact base and feature head, and chooses the simplest safe acquisition and publication path from `docs/AGENT-REPOSITORY-WORKFLOW.md`.

Normal Git remains preferred. When normal push is unavailable, ordinary UTF-8 text may be published through sequential Contents API writes after all affected files and blob SHAs have been read. Multiple focused feature-branch commits are acceptable because the PR can be squash-merged. Binary, byte-critical, mode-critical, high-volume, or explicitly atomic work uses the verified bundle and Git Data path instead.

The Builder runs the smallest relevant local checks available, compares the final branch once against its target, opens or updates a draft PR, and posts a top-level `## Builder handoff` comment containing branch, base, exact head, commits, files, local and CI checks, trigger matrix, acquisition/publication method, risks, and reviewer focus.

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

# Agent Handoff Workflow

GitHub is the durable handoff layer.

- Tracking issue: overall objective, phases, decisions, and child links.
- Child issue: one small implementation cycle with scope, non-goals, acceptance criteria, and reviewer focus.
- PR: implementation that closes the child issue and references the tracking issue.

## Planner

Plans without editing code. In the OpenAI web interface this normally uses `gpt-5.6-sol`; the local Codex planner sub-agent uses `gpt-5.4`. Defines narrow scope, non-goals, acceptance criteria, affected repositories, required checks, and manual accessibility gates.

## Builder

Uses the repository-local `gpt-5.4` Codex configuration, with high reasoning for architecture-heavy work. Reads issues and repository instructions, creates a thematic branch, implements only the child scope, runs checks, opens the PR, and posts a top-level `## Builder Handoff / Run Review` comment.

## Reviewer

In the OpenAI web interface this normally uses `gpt-5.6-sol`; the local Codex reviewer sub-agent uses `gpt-5.4`. Reads the complete durable context, checks diff and CI against acceptance criteria, and records `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. The Reviewer does not merge by default.

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
- CI is green or an explicit exception exists.
- Scope matches the child issue.
- Builder handoff is present.
- Reviewer result is persisted in GitHub.
- No blocking findings remain.
- Maintainer/orchestrator explicitly approves merge.

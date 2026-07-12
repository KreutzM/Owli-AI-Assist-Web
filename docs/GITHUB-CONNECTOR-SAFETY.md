# GitHub Connector Safety

- Resolve the exact repository, issue, PR, branch, and head SHA before write actions.
- Read the child issue, tracking issue, PR description, Builder handoff, diff, and CI before review.
- Builder handoffs are top-level PR conversation comments, not formal reviews.
- Reviewer results are formal reviews when possible, otherwise top-level `Reviewer result` comments.
- Do not merge from stale metadata; refetch PR state and expected head SHA.
- For workspace synchronization verify gitlink changes and avoid duplicate pointer PRs.
- Do not claim local checks were run when only connector inspection was possible.
- Never paste secrets, user media, tokens, or provider responses into GitHub.

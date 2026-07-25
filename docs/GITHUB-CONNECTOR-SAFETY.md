# GitHub Connector Safety

- Resolve the exact repository, issue, PR, target branch, feature branch, and head SHA before write actions.
- Prefer a local clone and normal Git. Use the permanent exact-head bundle workflow when clone/fetch is unavailable; do not reconstruct a repository from many connector file reads.
- Prepare formatting, tests, generated artifacts, and the complete diff before moving a feature-branch ref.
- For related multi-file API publication, use one tree, one commit, and one non-forced ref update based on a freshly re-read expected parent. A moved branch must fail safely.
- Use the Contents API only for an intentional isolated single-file change.
- Never add temporary bundle, formatter, diagnostic, or repair workflows to the feature branch being prepared.
- Read the child issue, tracking issue, PR description, Builder handoff, diff, and CI before review.
- Builder handoffs are top-level PR conversation comments, not formal reviews.
- Reviewer results are formal reviews when possible, otherwise top-level `Reviewer result` comments.
- Do not merge from stale metadata; refetch PR state and expected head SHA.
- For workspace synchronization verify gitlink changes and avoid duplicate pointer PRs.
- Do not claim local checks were run when only connector or CI inspection was possible.
- Never paste secrets, user media, tokens, or provider responses into GitHub.

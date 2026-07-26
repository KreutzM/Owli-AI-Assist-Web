# GitHub Connector Safety

- Resolve the exact repository, issue, PR, target branch, feature branch, and head SHA before write actions.
- Prefer a local clone and normal Git. Use the permanent exact-head bundle workflow when clone/fetch is unavailable and a real working tree is needed.
- For ordinary UTF-8 source, tests, Markdown, JSON, YAML, TOML, configuration, and small scripts, the Contents API is the default connector publication path.
- Before any `update_file`, read the current file and retain its blob SHA. Never overwrite an unconfirmed or stale SHA.
- Read all affected existing files first, then publish the intended changes. Serialize writes to the same path; unrelated paths may be handled independently.
- Multiple focused Contents API commits on a feature branch are acceptable. Use a squash merge when one clean commit is desired on `main`.
- Do not perform a complete branch comparison after every file. Compare once after the intended writes and verify target movement, expected paths, sizes, and deletions.
- Use the Git Data API only for binary, byte-critical, mode-critical, high-volume, reproducible-tree, or explicitly atomic publication.
- For Git Data publication, verify expected-parent ancestry, remote parent tree identity, returned tree identity, and a non-forced ref update. A moved branch or tree mismatch must fail safely.
- Never write directly to `main` through connector publication tools.
- Never add temporary bundle, formatter, diagnostic, or repair workflows to the feature branch being prepared.
- Read the child issue, tracking issue, PR description, Builder handoff, diff, and CI before review.
- Builder handoffs are top-level PR conversation comments, not formal reviews.
- Reviewer results are formal reviews when possible, otherwise top-level `Reviewer result` comments.
- Do not merge from stale metadata; refetch PR state and expected head SHA.
- For workspace synchronization verify gitlink changes and avoid duplicate pointer PRs.
- Do not claim local checks were run when only connector or CI inspection was possible.
- Never paste secrets, user media, tokens, or provider responses into GitHub.

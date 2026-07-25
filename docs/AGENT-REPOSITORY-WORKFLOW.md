# Agent Repository Acquisition and Atomic Publication

This workflow implements issue #42. Its primary rule is: **prepare one complete logical patch before moving the PR head**.

## Acquisition order

1. Use an existing local clone with normal `git fetch`, commits, and one push.
2. When clone/fetch is unavailable, dispatch `.github/workflows/repository-bundle.yml` for the exact branch, tag, PR head, or SHA.
3. Use connector file reads only for inspection or genuinely isolated single-file work.

The repository-bundle workflow checks out with full history, includes named `agent-head` and `agent-base` refs, verifies the bundle, records exact SHAs and SHA-256, and uploads only tracked Git objects for one day.

### Dispatch and download

```bash
gh workflow run repository-bundle.yml \
  -f ref=<branch-or-sha> \
  -f base_ref=main

gh run download <run-id> \
  --name repository-bundle-<exact-head-sha> \
  --dir artifacts/repository-bundle
```

Equivalent GitHub Actions REST calls may be used by a connector or runtime. The workflow is permanent on the default branch; never add a temporary preparation workflow to a feature branch.

### Materialize

```bash
bash scripts/materialize-repository-bundle.sh \
  artifacts/repository-bundle \
  ../owli-worktree \
  <expected-head-sha>
```

The script validates the manifest, SHA-256, `git bundle verify`, cloned branch, and exact local `HEAD`.

## Local preparation

Before publishing:

1. apply all source, test, workflow, and documentation edits;
2. run the repository formatter;
3. run the smallest relevant checks, then `pnpm check:fast`;
4. run `pnpm check:all` for the final logical head when browser coverage is relevant;
5. inspect `git diff --check`, file modes, additions, modifications, and deletions;
6. remove caches, logs, build outputs, and temporary workflows;
7. commit the complete patch locally.

The optional agent index is generated only on demand under `artifacts/agent-index/`; it is not part of the commit.

## Publication order

Normal Git is preferred:

```bash
git push --set-upstream origin <branch>
```

When normal push is unavailable, use the Git Data API fallback from a bundle-backed clone whose expected parent exists locally:

```bash
GITHUB_TOKEN=... pnpm atomic:publish -- \
  --repo KreutzM/Owli-AI-Assist-Web \
  --branch <feature-branch> \
  --expected-parent <verified-remote-head> \
  --source-ref HEAD
```

The publisher requires a clean committed tree, verifies ancestry, re-reads the remote branch, creates blobs and one tree, creates one commit with the expected parent, re-checks branch movement, and performs one non-force ref creation/update. A concurrent move fails safely; an unattached commit may remain but no branch is overwritten.

Use `--dry-run` to print the exact changed-path plan without network writes.

## Post-publication verification

Compare the published branch against both the expected previous head and the target branch. Confirm the new head, parent, intended paths, modes, deletions, commit count, and target movement. Prefer rerunning failed jobs for an unchanged tree instead of creating no-op commits.

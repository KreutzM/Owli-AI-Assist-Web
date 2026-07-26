# Agent Repository Acquisition and Connector Publication

This workflow implements issue #42. Its primary rule is: **use the simplest safe publication path for the actual file type and risk**.

## Acquisition order

1. Use an existing local clone with normal `git fetch`, commits, and push.
2. When clone/fetch is unavailable, dispatch `.github/workflows/repository-bundle.yml` for the exact branch, tag, PR head, or SHA.
3. Use connector file reads for inspection and for direct publication of ordinary UTF-8 text files.

The repository-bundle workflow checks out with full history, includes named `agent-head` and `agent-base` refs, verifies the bundle, records exact SHAs and SHA-256, and uploads only tracked Git objects for one day.

## Bundle dispatch and materialization

```bash
gh workflow run repository-bundle.yml \
  -f ref=<branch-or-sha> \
  -f base_ref=main

gh run download <run-id> \
  --name repository-bundle-<exact-head-sha> \
  --dir artifacts/repository-bundle
```

Equivalent GitHub Actions REST calls may be used by a connector or runtime. The workflow is permanent on the default branch; never add a temporary preparation workflow to a feature branch.

```bash
bash scripts/materialize-repository-bundle.sh \
  artifacts/repository-bundle \
  ../owli-worktree \
  <expected-head-sha> \
  <expected-base-sha> \
  KreutzM/Owli-AI-Assist-Web
```

The materializer validates the manifest, repository, SHA-256, declared head and base refs, `git bundle verify`, and exact cloned `HEAD`.

## Publication decision

### 1. Normal Git is preferred

Use normal Git whenever available:

```bash
git push --set-upstream origin <branch>
```

### 2. Contents API is the connector default for UTF-8 text

When normal push is unavailable, use `fetch_file`, `update_file`, `create_file`, and `delete_file` for ordinary UTF-8 text such as source, tests, Markdown, JSON, YAML, TOML, and small scripts.

Multiple focused connector commits on a feature branch are acceptable. The PR should normally be squash-merged so `main` receives one clean logical commit.

Required sequence:

1. verify current `main` and create or resolve the feature branch;
2. read every existing affected file first and retain its current blob SHA;
3. publish each path with the matching Contents API operation;
4. serialize writes to the same path and never overwrite an unconfirmed SHA;
5. do not perform a complete branch comparison after each file;
6. after all writes, compare the feature branch once against `main`;
7. confirm `behind_by == 0`, intended paths only, plausible sizes, and no accidental deletion;
8. open or update a draft PR and run exact-head CI.

Concurrency cancellation should keep intermediate draft Quick CI inexpensive. Full browser, Windows, and Apple validation belongs to the final non-draft head or an explicit full dispatch.

### 3. Git Data API is a specialized fallback

Use `tools/publish-atomic-git-data.mjs` only when at least one of these applies:

- binary content;
- exact byte, encoding, CRLF, executable mode, symlink, or Gitlink preservation;
- large generated files or high-volume multi-file publication;
- a mandatory single atomic commit;
- reproducible blob or tree SHAs are part of validation.

The publisher requires a clean committed tree, verifies expected-parent ancestry, confirms the remote parent tree, creates blobs and one tree, proves that the returned GitHub tree SHA equals the local source tree SHA, creates one commit, re-checks branch movement, and performs one non-force ref creation or update. A mismatch or concurrent move fails before the branch is overwritten.

```bash
GITHUB_TOKEN=... pnpm atomic:publish -- \
  --repo KreutzM/Owli-AI-Assist-Web \
  --branch <feature-branch> \
  --expected-parent <verified-remote-head> \
  --source-ref HEAD
```

Use `--dry-run` to inspect the path and tree plan without network writes.

## Local preparation and validation

Before publication, run the smallest relevant formatter, lint, type, unit, browser, or build checks available in the current environment. Do not claim local checks that were only performed by CI.

For direct Contents API publication, it is acceptable to format and validate the complete intended text before the sequential writes. For Git Data publication, commit the complete local tree before running the publisher.

The optional agent index is generated only on demand under `artifacts/agent-index/`; it is not part of the commit.

## Post-publication verification

Compare the finished branch against both its expected previous head and the target branch. Confirm the new head, intended paths, modes where relevant, deletions, commit count, and target movement. Prefer rerunning failed jobs for an unchanged tree instead of creating no-op commits.

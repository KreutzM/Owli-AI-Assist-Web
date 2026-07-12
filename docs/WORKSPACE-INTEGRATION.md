# Workspace Integration

After creating `KreutzM/Owli-AI-Assist-Web` and pushing its initial `main`, integrate it through a reviewed workspace branch.

```bash
git checkout -b pwa-mvp/add-web-submodule origin/main
git submodule add -b main git@github.com:KreutzM/Owli-AI-Assist-Web.git web
git add .gitmodules web
```

Expected workspace shape:

```text
app/      -> KreutzM/Owli-AI-Assist
web/      -> KreutzM/Owli-AI-Assist-Web
backend/  -> KreutzM/OwliAI-BackEnd
```

Update at least:

- `.gitmodules`
- `README.md`
- `CHATGPT.md`
- `AGENTS.md`
- `docs/REPO_MAP.md`
- `docs/API_CONTRACT.md`
- `.ai/workspace-guide.md`
- `.ai/cross-repo-map.md`

Workspace wording must change from “two repositories” to three runtime submodules. Add `web/` to source-of-truth, branch-first, done-criteria, and API compatibility rules.

The landing-site repository remains separate because it has an independent marketing/SEO lifecycle.

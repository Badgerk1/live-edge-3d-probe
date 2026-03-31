# Security & Automation Policy

This document explains which GitHub security settings apply to this repository and how to configure them so that GitHub Copilot agents and other automation tools can operate without being blocked.

---

## Why Copilot agents are blocked ("GitHub firewall")

When a Copilot coding agent (or any automated task) is unable to push commits, create branches, or write to the repository, it is almost always caused by one or more of the following GitHub security controls:

| Setting | Where to change it | Typical symptom |
|---|---|---|
| **Copilot agent write-access not granted** | Repo → Settings → Copilot → Policies | Agent says "I cannot perform the repo write action" |
| **Branch protection on `main`** | Repo → Settings → Branches | Push/merge blocked; status check or review required |
| **GitHub Actions permissions too restrictive** | Repo → Settings → Actions → General | Workflow `GITHUB_TOKEN` is read-only |
| **Required SSO authorisation** | Organisation → Settings → OAuth & PAT | 403 on API calls with a non-SSO token |
| **IP allow-list** | Organisation → Settings → Security → IP allow list | Connection refused or 403 from GitHub-hosted runners |
| **Secret-scanning push protection** | Repo → Settings → Code security | Push rejected when a secret pattern is detected in a commit |
| **Rulesets / enterprise policies** | Enterprise → Policies | Blanket deny on forks or certain user identities |

---

## Recommended minimum-permissive fixes

### 1 — Allow Copilot agents to read and write the repository

1. Navigate to **Repository → Settings → Copilot**.
2. Under **"Copilot in GitHub.com"**, confirm that **Coding agent** is set to **Enabled**.
3. Under **Access**, ensure the agent is allowed to **read and write code** (not read-only).

### 2 — Relax branch protection for the working branch only

Branch protection on `main` is good practice; do **not** remove it. Instead, allow the agent's PR workflow to work:

1. Navigate to **Repository → Settings → Branches → Branch protection rules** for `main`.
2. Ensure **"Allow force pushes"** is **off** (keep it that way).
3. If required status checks are blocking merges, add the Copilot check as a required check — or allow bypass for repository owners/admins.
4. Agents always work on a **feature branch** (e.g., `copilot/...`), so branch protection on `main` does not prevent them from pushing their work branch.

### 3 — Grant `GITHUB_TOKEN` write access for Actions

1. Navigate to **Repository → Settings → Actions → General**.
2. Under **"Workflow permissions"**, select **"Read and write permissions"**.
3. Optionally check **"Allow GitHub Actions to create and approve pull requests"** if you want automated PRs.

### 4 — Check for IP allow-lists (organisations only)

If your organisation uses an **IP allow list** (Settings → Security → IP allow list):

* GitHub-hosted runners and the Copilot agent backend operate from GitHub's own IP ranges.
* You do **not** need to add manual IP entries; instead, enable **"Allow GitHub Actions"** and **"Allow GitHub Copilot"** in the allow-list settings, which automatically trusts GitHub's own service IP ranges.

### 5 — Secret-scanning push protection

This is enabled by default on public repositories and should stay on. Copilot agents are instructed not to commit secrets, so this should not trigger for normal version-bump tasks. If it does:

* Review the push rejection message — it will name the file and the pattern that matched.
* Remove the detected secret or rotate it before pushing.

---

## Steps to reproduce the block (for diagnosis)

1. Create a new Copilot coding task that attempts to push a commit (e.g., a version bump).
2. If the task log shows **"not able to perform the repo write action"** or **"403 Forbidden"**, the block is in settings 1–3 above.
3. If the log shows **"push declined due to repository rule"**, the block is in setting 2 (branch protection) or rulesets.
4. If the log shows **"push declined due to secret scanning"**, the block is in setting 5.
5. If the agent cannot even read the repository, check SSO authorisation (setting 4).

---

## What has been changed in this PR

This PR (v21.0.0 major version bump) was performed by the Copilot coding agent after the automation block was identified. The changes are:

| File | Change |
|---|---|
| `manifest.json` | `"version"` bumped from `20.0.0` → `21.0.0` |
| `src/js/core.js` | `SM_VERSION` changed from `'V20.0'` → `'V21.0'` |
| `src/config-body.html` | Two hardcoded `V20.0` UI strings updated to `V21.0` |
| `index.js` | Stale `v2.1.0` log strings corrected to `v21.0.0` |
| `config.html` | Regenerated via `./build.sh` (do not edit directly) |
| `.github/workflows/build.yml` | CI workflow to run `./build.sh` on push |
| `SECURITY.md` | This file — documents GitHub security settings |

Data-schema versions in `src/js/probe-engine.js` (`version: '1.7.0'`) were intentionally left unchanged (Option A — schema not modified).

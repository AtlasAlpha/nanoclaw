# Fine-Grained PAT Permissions Report

## Overview

This report explains every permission granted to the Personal Access Token (PAT) for the `nanoclaw` repository. The token is scoped **only to this repo** — it cannot access any other repository under AtlasAlpha.

---

## Contents — Read & Write

**What it controls**: The actual code and files in the repository.

### Read operations
- `git clone` — download the repo to your machine
- `git pull` — get latest changes from GitHub
- `git fetch` — check for new branches/commits without merging
- Browse the repo on GitHub (files, commit history, branches, tags, releases)

### Write operations
- `git push` — upload your commits to GitHub
- `git commit` — record changes locally (this is local, but push needs write)
- Create, delete, and rename branches
- Create and delete tags
- Upload release assets
- Edit files directly on GitHub.com (web editor)
- Manage repository settings like default branch, merge buttons, and collaboration settings (if you also have `administration` permission)

### What you CAN'T do
- Delete the repository
- Transfer ownership
- Change repo visibility (public/private)
- Add/remove collaborators

These require `administration` permission or owner-level access.

---

## Issues — Read & Write

**What it controls**: Bug reports, feature requests, and task tracking.

### Read operations
- View all issues (open and closed)
- Read comments, labels, assignees, milestones
- See issue timeline (cross-references, events)

### Write operations
- `gh issue create` — open a new issue
- `gh issue close` — close an existing issue
- `gh issue comment` — add a comment
- `gh issue edit` — change title, body, labels, assignees, milestone
- `gh issue label` — add or remove labels
- `gh issue assign` — assign to yourself or others
- `gh issue lock` — lock/unlock conversation
- Pin/unpin issues

### Common commands
```powershell
gh issue create --title "Bug: login crashes" --label "bug"
gh issue list --assignee "@me"
gh issue view 5
gh issue close 5 --comment "Fixed in PR #12"
```

### How it fits in the workflow
1. Create an issue describing the task
2. Assign it to yourself
3. Label it (bug, enhancement, etc.)
4. Work on the code
5. Reference the issue in commits (`fixes #5`)
6. Close it when done

---

## Pull Requests — Read & Write

**What it controls**: Code review and merging changes between branches.

### Read operations
- View all PRs (open, closed, merged)
- See diff/changed files
- Read review comments
- Check CI status on the PR
- See merge conflicts

### Write operations
- `gh pr create` — open a new pull request
- `gh pr review` — submit a review (approve, comment, request changes)
- `gh pr comment` — leave a general comment on the PR
- `gh pr merge` — merge the PR (merge, squash, rebase)
- `gh pr close` — close without merging
- `gh pr edit` — change title, body, reviewers, labels, milestone
- `gh pr ready` — mark draft PR as ready for review
- `gh pr checkout` — checkout a PR locally
- Add/remove reviewers
- Add/remove assignees
- Re-request review

### What you CAN'T do
- Bypass branch protection rules (requires admin)
- Force push to protected branches
- Delete a branch that has a protection rule

### Common commands
```powershell
gh pr create --title "Add login" --body "Closes #5" --assignee "@me"
gh pr review 12 --approve
gh pr review 12 --request-changes --body "Fix the typo"
gh pr merge 12 --squash
gh pr list --state open --author "@me"
```

### How it fits in the workflow
1. Create a branch from an issue
2. Make changes and commit
3. Push the branch
4. Open a PR linking the issue (`Closes #5`)
5. Request review from teammates
6. Address review feedback
7. Merge when approved
8. Delete the branch

---

## Workflows — Read & Write

**What it controls**: GitHub Actions automation files.

### Read operations
- View workflow files in `.github/workflows/`
- See workflow runs and their logs
- Check workflow run history

### Write operations
- Create new workflow files
- Edit existing workflow files
- Delete workflow files
- Manage workflow secrets and environment variables
- Trigger workflow dispatches

### IMPORTANT: This does NOT control
- The **actual execution** of workflows (that's handled by GitHub's runner infrastructure)
- The workflow results (commit statuses) — that's a separate permission
- Viewing or managing secrets — that requires `secrets` permission

### What you can do
```powershell
# Edit a workflow to change CI behavior
# Add a new deployment workflow
# Modify test commands in the CI pipeline
```

### What you CAN'T do
- View secrets stored in GitHub (`secrets` permission needed)
- Bypass required workflow checks
- Run workflows on behalf of other users

---

## Metadata — Read

**What it controls**: Basic repository information.

This is **automatically granted** with any Fine-Grained PAT and cannot be removed. It's the minimum needed to identify the repository.

### What you can see
- Repository name and description
- Public/private status
- Number of stars, forks, watchers
- Topics and tags
- Owner and organization info
- Default branch name
- Repository ID (used in API calls)

### Why it's required
Without metadata access, GitHub can't even tell the API which repo you're talking about. It's the foundation all other permissions build on.

---

## Commit statuses — Read

**What it controls**: CI/CD check results on commits and PRs.

### What you can see
- Whether a commit passed or failed checks
- Individual check names (e.g., "Tests", "Lint", "Build")
- Check run details and logs (links to the runner)
- Combined status for PRs (required checks passing/failing)
- Branch protection rule status

### What you can't do
- Rerun failed checks
- Cancel running checks
- Create or update check runs
- Override required checks

### Why it matters
When you create a PR, you need to see if the CI checks pass. If a required check fails, you can't merge. This permission lets you monitor that.

---

## Summary Table

| Permission | Level | What it enables |
|---|---|---|
| Contents | R&W | All code operations — clone, push, branches, commits |
| Issues | R&W | Full issue management — create, assign, label, close |
| Pull Requests | R&W | Full PR lifecycle — create, review, merge |
| Workflows | R&W | Edit GitHub Actions `.yml` files |
| Metadata | R | Basic repo info (auto-granted) |
| Commit statuses | R | See CI check results |

## What's Missing (and why)

| Feature | Why it's not here |
|---|---|
| **Projects/Kanban** | Fine-Grained PATs don't support Projects on user accounts. Would need Classic PAT or an Organization account. |
| **Administration** | Would allow deleting the repo or changing settings. Not needed for everyday work. |
| **Secrets** | Would allow viewing/managing GitHub secrets. Kept separate for security. |
| **Webhooks** | Would allow managing repo webhooks. Not needed for development. |

---

## End-to-End Workflow Example

```powershell
# 1. Create an issue
gh issue create --title "Add dark mode toggle" --label "enhancement"

# 2. Create a branch
git checkout -b feature/dark-mode

# 3. Make changes (using opencode or your editor)
# ...

# 4. Commit and push
git add .
git commit -m "Add dark mode toggle, closes #3"
git push -u origin feature/dark-mode

# 5. Open a PR
gh pr create --title "Add dark mode toggle" --body "Closes #3" --assignee "@me"

# 6. Wait for CI to pass
# ...

# 7. Merge
gh pr merge --squash
```

Each permission plays a specific role in this cycle. Together they cover the full development workflow without overreaching into admin territory.

# Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for all git commit messages.

## Format

```
type(scope): description

[optional body]

[optional footer]
```

## Types

| Type       | Purpose                                            |
|------------|----------------------------------------------------|
| `feat`     | New feature or capability                          |
| `fix`      | Bug fix                                            |
| `refactor` | Code restructuring without behavior change         |
| `docs`     | Documentation only                                 |
| `test`     | Adding or updating tests                           |
| `chore`    | Build, CI, dependency, or tooling changes          |
| `perf`     | Performance improvement                            |
| `style`    | Formatting, whitespace (no logic change)           |

## Scopes

| Scope              | When to use                                |
|--------------------|--------------------------------------------|
| `backend`          | Python/FastAPI backend changes             |
| `frontend`         | React/TypeScript frontend changes          |
| `wallet-connector` | Wallet connector package changes           |
| `docker`           | Docker/compose configuration               |
| `migration`        | Database migration scripts                 |
| `backup`           | Backup/restore functionality               |
| `i18n`             | Internationalization                       |
| *(omit scope)*     | Cross-cutting or monorepo-level changes    |

## Rules

1. **Subject line** — imperative mood, lowercase, no period, max 72 chars
2. **Scope** — optional; use when the change is clearly scoped to one area
3. **Body** — explain *what* and *why*, not *how*; wrap at 72 chars
4. **Breaking changes** — add `BREAKING CHANGE:` footer
5. **One logical change per commit** — avoid mixing unrelated changes

## Examples

```
feat(backend): add pending actions API endpoint

Expose /api/pending-actions to let the frontend poll for
signable transactions across all wallets.
```

```
fix: resolve MissingGreenlet errors from lazy-loaded relationships
```

```
refactor(frontend): extract shared network page components

Move NetworkCard, NodeRow, and AddNodeButton into shared/
to eliminate duplication between EVM and BTC network pages.
```

```
docs: update quickstart guide for Docker setup
```

## Tags & Releases

- Tags follow semver: `v0.1.0`, `v0.1.1`, `v0.2.0`, etc.
- Create a tag on the merge commit or the final commit of a release.

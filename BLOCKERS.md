# Blockers

Questions an agent cannot answer alone. Append here, mark the PROGRESS.md task
`⛔`, skip it, keep going. Never guess and build on the guess.

Format:

```
## [phase-0X] short title
**Task:** which PROGRESS.md item
**Question:** what's genuinely undecidable without a human
**Assumed for now:** what was done instead, if anything
```

---

None open.

Deferred by decision, not by obstacle:

- **Replay parsing** — needs a corpus of real Showdown logs. `replay_url` is
  stored normalized, and `match_stats` / `replay_cache` exist unused, so the
  parser drops in without a migration. See `plans/future.md`.
- **Post-trade point cap** — the check exists in `validateTrade` but is wired
  off, because most leagues want value to drift after the draft. Turning it on
  is one field in `rules()`.

Resolved:

- **OAuth credentials (phase 1)** — no longer blocking. Providers are built
  conditionally from env, so blank credentials mean the provider isn't
  registered and email/password carries development. Real credentials are a
  later, optional step.

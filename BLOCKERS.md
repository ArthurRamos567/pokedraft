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

Resolved:

- **OAuth credentials (phase 1)** — no longer blocking. Providers are built
  conditionally from env, so blank credentials mean the provider isn't
  registered and email/password carries development. Real credentials are a
  later, optional step.

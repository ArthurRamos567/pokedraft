# Blockers

Questions an agent cannot answer alone. Append here, skip the task, keep going.
Never guess and build on the guess.

Format:

```
## [phase-0X] short title
**Task:** which PROGRESS.md item
**Question:** what's genuinely undecidable without a human
**Assumed for now:** what was done instead, if anything
```

---

## [phase-01] OAuth credentials

**Task:** 1.12 Better Auth social providers
**Question:** Discord and Google client IDs/secrets need to be registered by a
human at the provider consoles and put in `.env`.
**Assumed for now:** email/password enabled and working; social providers
configured in code but inert without the env vars. `.env.example` documents
every key.

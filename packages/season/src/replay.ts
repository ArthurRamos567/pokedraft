/**
 * Replay *parsing* is deferred (see plans/future.md) — it needs a corpus of
 * real Showdown logs to build against, and without fixtures a parser is
 * guesswork dressed as code.
 *
 * What v1 does is store the link as evidence a human can click during a
 * dispute. Normalizing to the bare id here is what lets the parser drop in
 * later without a migration.
 */
export type ReplayRef = { id: string; url: string }

const PATTERNS = [
  /^https?:\/\/replay\.pokemonshowdown\.com\/([a-z0-9-]+)(?:\.(?:json|log))?(?:\?.*)?$/i,
  /^https?:\/\/replay\.pokemonshowdown\.com\/([a-z0-9-]+)\/?$/i,
]

export function parseReplayUrl(input: string): ReplayRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  for (const re of PATTERNS) {
    const m = re.exec(trimmed)
    if (m?.[1]) return { id: m[1].toLowerCase(), url: replayUrl(m[1].toLowerCase()) }
  }

  // A bare id is what people paste half the time.
  if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(trimmed)) {
    const id = trimmed.toLowerCase()
    return { id, url: replayUrl(id) }
  }
  return null
}

export const replayUrl = (id: string) => `https://replay.pokemonshowdown.com/${id}`

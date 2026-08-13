import { createFileRoute, Link } from '@tanstack/react-router'
import { useSession } from '../lib/auth'

export const Route = createFileRoute('/')({ component: Landing })

const FEATURES = [
  {
    k: '01',
    t: 'Live or async drafts',
    d: 'A pick timer for draft night, or turn deadlines measured in days. Same engine, same rules, one event log you can replay.',
  },
  {
    k: '02',
    t: 'Every format, every mon',
    d: 'Species, tiers, learnsets and legality straight from the Showdown data. Change the format and the pool changes with it.',
  },
  {
    k: '03',
    t: 'Points by YAML',
    d: 'Drop in the sheet you already keep. Preview the diff, see what resolved and what did not, then commit.',
  },
  {
    k: '04',
    t: 'The whole season',
    d: 'Round-robin schedule, result reporting with replay links, derived standings, and a bracket at the end of it.',
  },
]

function Landing() {
  const { data: session } = useSession()

  return (
    <div className="wrap stack reveal" style={{ gap: 40 }}>
      <section
        style={{
          display: 'grid',
          gap: 32,
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
          alignItems: 'center',
          paddingTop: 32,
        }}
      >
        <div className="stack" style={{ gap: 18 }}>
          <span className="label">Draft leagues · Pokémon · every format</span>
          <h1 style={{ maxWidth: '14ch' }}>
            Run the draft.
            <br />
            <span style={{ color: 'var(--live)' }}>Keep the receipts.</span>
          </h1>
          <p className="dim" style={{ fontSize: 16, maxWidth: '52ch' }}>
            A draft league platform that treats the draft as an append-only log, the roster as a
            derivation, and the points list as something you can version. Nothing about your league
            lives in a spreadsheet tab somebody forgot to share.
          </p>
          <div className="wrap-row" style={{ marginTop: 4 }}>
            {session ? (
              <>
                <Link to="/dashboard" className="btn btn-primary btn-lg">
                  Go to my leagues
                </Link>
                <Link to="/leagues/new" className="btn btn-ghost btn-lg">
                  Start a league
                </Link>
              </>
            ) : (
              <>
                <Link to="/signup" className="btn btn-primary btn-lg">
                  Create an account
                </Link>
                <Link to="/leagues" className="btn btn-ghost btn-lg">
                  Browse public leagues
                </Link>
              </>
            )}
          </div>
        </div>

        {/* A still frame of the product: the draft board, mid-round. */}
        <div className="card" style={{ padding: 14, transform: 'rotate(-0.6deg)' }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="badge badge-live">
              <i className="dot" />
              on the clock
            </span>
            <span className="timer">01:24</span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {[
              ['1.01', 'Landorus-Therian', 20, 'ground'],
              ['1.02', 'Gholdengo', 19, 'steel'],
              ['1.03', 'Kingambit', 18, 'dark'],
            ].map(([no, name, cost, type]) => (
              <div key={String(no)} className="board-cell filled" style={{ minHeight: 44 }}>
                <div className="row-between">
                  <span className="label">{no}</span>
                  <span className="cost">{cost}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="type" style={{ ['--tc' as string]: `var(--type-${type})` }}>
                    {String(type).slice(0, 3)}
                  </span>
                  <strong style={{ fontSize: 13 }}>{name}</strong>
                </div>
              </div>
            ))}
            <div className="board-cell onclock" style={{ minHeight: 44 }}>
              <span className="label">1.04</span>
              <span className="dim" style={{ fontSize: 13 }}>
                waiting on Team Quagsire…
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {FEATURES.map((f) => (
          <article key={f.k} className="card card-pad stack" style={{ gap: 8 }}>
            <span className="label" style={{ color: 'var(--live)' }}>
              {f.k}
            </span>
            <h3>{f.t}</h3>
            <p className="dim" style={{ margin: 0 }}>
              {f.d}
            </p>
          </article>
        ))}
      </section>
    </div>
  )
}

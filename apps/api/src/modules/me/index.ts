import { Elysia, t } from 'elysia'
import { authPlugin } from '../../plugins/auth'

const MeResponse = t.Object({
  id: t.String(),
  email: t.String(),
  name: t.String(),
  displayName: t.Nullable(t.String()),
  showdownUsername: t.Nullable(t.String()),
  avatarUrl: t.Nullable(t.String()),
})

export const meModule = new Elysia({ name: 'me', tags: ['users'] }).use(authPlugin).get(
  '/me',
  ({ user }) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName ?? null,
    showdownUsername: user.showdownUsername ?? null,
    avatarUrl: user.avatarUrl ?? user.image ?? null,
  }),
  {
    auth: true,
    response: MeResponse,
    detail: { summary: 'The signed-in user. 401 without a session cookie.' },
  },
)

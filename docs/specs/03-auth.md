# 03 — Authentication & Authorization

Two identity providers coexist:

- **Keycloak (OIDC, AD-backed)** — primary path for end users.
- **Local accounts** — Argon2id username + password, for admin/QA bootstrap and as a break-glass path when Keycloak is unavailable.

Both materialize into the **same `users` row** (distinguished by `users.provider`), so the rest of the app is provider-agnostic.

Then, regardless of how the user logged in, they attach a **Jira PAT** so the worker can act on Jira on their behalf. A future Atlassian OAuth path is reserved.

## Provider toggles (env)

```
AUTH_KEYCLOAK_ENABLED=true|false      # default true
AUTH_LOCAL_ENABLED=true|false         # default true (for bootstrap)
AUTH_LOCAL_ALLOW_SIGNUP=false         # self-signup disabled by default
```

If both providers are enabled, the `/login` page shows two cards. If only one is enabled, the other is hidden and direct visits to its routes 404.

## Flow A — Keycloak (OIDC Authorization Code + PKCE)

```
Browser → /api/auth/keycloak/login
  → redirect to Keycloak authorize
  → user authenticates against AD
  → redirect to /api/auth/keycloak/callback?code=…
  → server exchanges code (PKCE), reads id_token claims
  → upsert users row (provider='keycloak', externalSub=sub)
  → create user_sessions row, Set-Cookie: session=<sid>
  → 302 to /
```

Session cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`.  
Idle TTL 8h, absolute TTL 30d, refresh-token rotation on renewal, end_session call best-effort on logout.

Roles are computed from the `groups` claim mapped via env:

```
ROLE_GROUP_MAP={"app-admins":"app_admin","team-leads":"team_admin"}
```

## Flow B — Local accounts

### Bootstrap

A CLI in `apps/server` creates the first admin:

```
bun run cli users create --username admin --role app_admin
# prompts for a password; writes users + local_credentials
```

The CLI is the only way to grant `app_admin` for a local account. `team_admin` is grantable by `app_admin` via `/api/admin/users/:id/roles`.

### Login

```
POST /api/auth/local/login
  body: { username, password }
→ server:
  1. look up local_credentials by username (constant-time miss path)
  2. argon2id verify
  3. enforce lockout: if failed_attempts >= 5, locked_until = now + 2^(attempts - 5) min, capped at 60min
  4. on success: reset attempts, set last_login_at, create user_sessions row
  5. if must_change=1, force a password-change redirect
```

### Password rules

- Min 12 chars, no length cap, no composition rules (NIST-aligned).
- Banned passwords: top 10k breached list embedded at build time.
- Stored as Argon2id (`@node-rs/argon2`, `m=64MB, t=3, p=1`). Parameters re-checked at login; on mismatch we re-hash with current params (silent upgrade).

### Self-service password change

```
POST /api/auth/local/change-password
  body: { currentPassword, newPassword }
  requireAuth + provider='local'
```

### Disabling a user

`PATCH /api/admin/users/:id/disable` sets `users.disabled_at` and revokes all sessions. The login path checks `disabled_at IS NULL`.

## Sessions: shared between providers

The `user_sessions` table is identical regardless of provider. Anything reading `request.session.user` doesn't care how the user authenticated.

## Flow C — Jira PAT attach (unchanged in spirit, refined for clarity)

Independent of how the user logged in:

```
POST /api/auth/jira-pat   { token: "<PAT>" }
  1. validate by calling GET /rest/api/2/myself with Bearer <PAT>
  2. capture { accountId, name, displayName, emailAddress }
  3. envelope-encrypt (AES-GCM): generate per-user DEK, wrap with JIRA_PAT_KEK
  4. upsert jira_credentials (user_id, kind='pat', ciphertext, iv, tag, kek_kid)
  5. update users.jira_account_id, users.jira_user_key
```

`DELETE /api/auth/jira-pat` removes the row.  
`GET /api/auth/jira-pat/test` round-trips `myself`, updates `last_used_at`, flips `needs_reattach=true` on 401/403.  
**The PAT plaintext is only ever in memory inside a worker call. It is never logged, never echoed.**

## Flow D — Atlassian OAuth (future, reserved)

When added, `jira_credentials.kind='oauth'`. The same `jiraCredentialService.getBearer(userId)` indirection covers both — worker code does not branch.

## Authorization model

We do not reimplement Jira permissions. Any issue a worker can't fetch with a user's PAT simply isn't visible to that user.

In-app roles (additive):

| Role         | Default for   | Capabilities                                            |
| ------------ | ------------- | -------------------------------------------------------- |
| `user`       | every login   | Read everything their PAT allows; write their own changes |
| `team_admin` | Keycloak group OR granted by app_admin | Manage saved views, manage WIP limits per board |
| `app_admin`  | Keycloak group OR local bootstrap     | Manage global settings, trigger backfills, view audit log |

## Server middleware (Elysia)

```ts
// apps/server/src/plugins/auth.ts (sketch)
import { Elysia } from 'elysia'

export const auth = new Elysia({ name: 'auth' })
  .derive(async ({ cookie }) => {
    const sid = cookie.session.value
    const session = sid ? await sessionStore.get(sid) : null
    const user = session ? await userRepo.byId(session.userId) : null
    return { user, session }
  })
  .macro(({ onBeforeHandle }) => ({
    requireAuth(value: boolean) {
      if (!value) return
      onBeforeHandle(({ user, set }) => {
        if (!user) { set.status = 401; return { error: { code: 'unauthenticated' } } }
      })
    },
    requireRole(role: 'user' | 'team_admin' | 'app_admin') {
      onBeforeHandle(({ user, set }) => {
        if (!user || !hasRole(user, role)) {
          set.status = 403; return { error: { code: 'forbidden' } }
        }
      })
    },
  }))
```

Routes opt in: `requireAuth: true`, `requireRole: 'app_admin'`.

## Frontend behavior

- `/login` is the only public route. Shows enabled provider cards.
- After login, if the user has no Jira PAT attached, the router redirects to `/settings/jira` and gates the rest of the app behind PAT attach.
- The SPA reads `/api/auth/me`:
  ```ts
  { user: { id, displayName, email, provider, roles }, jiraConnected, jiraDisplayName?, jiraNeedsReattach? }
  ```
- The SPA never reads tokens. Eden Treaty uses `credentials: 'include'` so cookies flow.
- When `jiraNeedsReattach=true`, a top banner offers a re-attach flow.

## Audit

Every state-changing auth action logs to `audit_log`:

- `auth.local.login.success / failure`
- `auth.keycloak.callback.success / failure`
- `auth.session.revoked`
- `auth.jira_pat.attached / removed / validation_failed`
- `auth.local.password_changed`
- `admin.user.role_granted / role_revoked / disabled / enabled`

## Env contract

```
# Required regardless of provider
APP_BASE_URL=https://jira-ui.internal
SESSION_COOKIE_NAME=jira_ui_sid
JIRA_PAT_KEK=base64(32 bytes)
DATABASE_URL=postgres://...

# Keycloak (only required if AUTH_KEYCLOAK_ENABLED=true)
KEYCLOAK_ISSUER_URL=...
KEYCLOAK_CLIENT_ID=...
KEYCLOAK_CLIENT_SECRET=...
ROLE_GROUP_MAP={"app-admins":"app_admin", ...}

# Local
AUTH_LOCAL_ENABLED=true
AUTH_LOCAL_ALLOW_SIGNUP=false
```

Env is validated at boot with Elysia's `t.*` — fail fast on missing keys.

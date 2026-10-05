# Development Environment Runbook

## Supported toolchain

- Node.js: `22.22.2`
- npm: `11.9.0`

The repository pins these versions in `.nvmrc`, `.node-version`, and
`package.json`. npm rejects unsupported Node/npm versions so that local and CI
results do not silently diverge.

## Install

```bash
nvm install
nvm use
npm install --global npm@11.9.0
npm ci
```

Do not commit `.env`, credentials, generated `dist/`, or `node_modules/`.

## Environment

Copy `.env.example` to `.env`. No environment variable is required to render
the public landing page or run the local health endpoint. Owner Auth remains
intentionally unavailable until the exact current portal origin is configured;
the UI will not render an email/password field on any other host. A real
staging Supabase connection is required for Owner authentication, cloud
restoration, staff PIN verification, device pairing, and remote Realtime
behavior.

| Variable | Required for | Handling |
|---|---|---|
| `VITE_SUPABASE_URL` | Real Auth/database/Realtime paths | Staging project URL; safe for the browser. |
| `VITE_SUPABASE_ANON_KEY` | Real Auth/database/Realtime paths | Staging anon/public key; safe for the browser subject to correct RLS. |
| `VITE_OWNER_PORTAL_ORIGIN` | Owner sign-in, signup, confirmation, and recovery | Exact current public origin; HTTPS with no path, wildcard, or trailing slash. For local development only, an explicit `http://localhost:<port>` value is accepted. It must match the Supabase Auth Site URL and the allow-list must also contain the exact `<origin>?auth=recovery` return URL. |
| `DISABLE_HMR=true` | Optional constrained preview environments | Disables Vite HMR and file watching. |

Never place a service-role key, personal access token, database password, or
production credential in a `VITE_*` variable. Those secrets must be supplied
through an approved secret manager or secure engineering environment, not the
repository or chat.

## Run

Recommended integrated development server (frontend plus the repository's
Express routes):

```bash
npm run dev:server
```

- Application: `http://localhost:3000`
- Server health: `http://localhost:3000/api/health`

Frontend-only Vite mode is also available when the Express routes are not
needed:

```bash
npm run dev
```

- Frontend-only URL: `http://localhost:5173`

Use a separate browser profile for staging. Open DevTools Console and Network,
preserve logs during reload, and treat failed Supabase/Auth/Realtime requests
as defects or missing staging configuration rather than hiding them.

## Validate

```bash
npm test
npm run test:r002
npm run lint
npm run build
npm start
```

`npm test` is the complete existing application suite. `npm run test:r002` is
the isolated R002 migration safety gate. `npm start` serves the production
bundle on `http://localhost:3000` after `npm run build`.

## Clean-state reproduction

Stop running processes, then run:

```bash
npm run clean
npm ci
npm test
npm run test:r002
npm run lint
npm run build
npm start
```

For a first-run browser check, also clear site data for `localhost` or use a
fresh browser profile. Do not delete or rewrite application data in a real
staging project as part of a local clean restart.

## Current test expectation

The environment must report the repository honestly. At the Phase 1 baseline,
the R002 gate passes while two existing CloudSyncAdapter tests fail because no
remote adapter is configured. A clean installation is reproducible even while
those product failures remain an explicit release blocker.

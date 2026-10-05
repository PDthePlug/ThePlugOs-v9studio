# ADR-014 — Reconnect the frontend to the established Supabase application

Date: 5 October 2026. Authority: the user's clarification that this is frontend work against the existing backend.

The browser replacement commits introduced Better Auth, a new database schema and cloud-only financial authority. That was the wrong integration for this project. Restore the existing Supabase Auth, owner/business RLS, ordered migration source, engine packages and Android device runtime from ef14027. Preserve the replacement commits in Git history; do not apply their database migrations to Supabase.

Improve the owner dashboard using the existing owner-scoped tables and existing enrollment/recovery endpoints. Use the actual branch, staff, catalog and order identities. Reports explicitly describe their available date basis. Missing or failed queries must show an unavailable state, never invented zero revenue or healthy devices. Add automatic station view refresh through the existing native operator-context bridge without moving PINs, device keys or financial command authority into React.

No database reset, new authentication provider, new project or new operational backend is part of this correction. Existing Supabase environment variables remain the application's configuration. Supabase connector access is not required to build or use its published browser API; privileged deployment inspection still requires an authorized account.

The archived source records that R003 revoked browser execution of legacy pairing/PIN/bootstrap functions. It also records source-only Edge receivers and native release gaps. These records explain the integration boundary; they do not prove today's deployed endpoint state. Network-proxy failures from this environment are not evidence that Supabase is down.

Verification must separate: frontend renderer/API-contract tests, real Supabase owner sign-in, deployed pairing/PIN endpoints, and physical independent-device/local-link acceptance. Browser fixtures must never be represented as real device pairing or PIN authentication. Preserve native authority and existing release gates while producing a usable frontend.

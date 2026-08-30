# Production cloud configuration manifest

- **Status:** Prepared, not applied
- **Target:** `iwbbwcaylpulcpvbfkdx` (ThePlugOS, `eu-west-1`)
- **Schema baseline:** R001A–R013 recorded; R014 is source-complete but not applied
- **Function inventory at preparation:** no deployed Edge Functions
- **Product release status:** HOLD

## Purpose

This is the precise non-source configuration needed before the existing Hub
receivers can be deployed. It deliberately contains no key, PIN, password,
JWT, private JWK, database credential, or owner identity.

## Platform-provided keys

The project already has a modern publishable key. The functions use the
platform-provided named key maps below, preferring the rotatable `default`
entry and failing closed on malformed configuration:

| Runtime map | Used only by | Required use |
| --- | --- | --- |
| `SUPABASE_PUBLISHABLE_KEYS.default` | `hub-owner-enrollment` | Validate the signed-in owner session with the request's user JWT |
| `SUPABASE_SECRET_KEYS.default` | All six baseline Hub Functions | Service-only RPC client; never sent to a browser or Android app |

Legacy variables remain a transition-only fallback in source. Do not disable
legacy keys until the deployed receiver health checks have proved the modern
maps are present and all browser clients use the publishable key.

## Custom Function runtime values

Create these values only in the Supabase project’s Edge Function secret store.
They must not enter a GitHub secret, `.env` file, Android Gradle property,
browser variable, chat message, or source file.

| Name | Requirement | Initial production value / decision |
| --- | --- | --- |
| `HUB_AUTHORIZATION_ISSUER_KEY_ID` | Public label matching the Android issuer-key map | Choose one stable label, e.g. `prod-issuer-2026-08` |
| `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON` | P-256 private JWK with `kty=EC`, `crv=P-256`, and private `d` material | Generate in the approved secret store; retain only there |
| `HUB_RATE_LIMIT_PEPPER` | Random, at least 32 high-entropy characters | Generate in the secret store; never reuse an application password |
| `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES` | Integer from 15 through 720 | `120` for the controlled pilot unless a separately accepted continuity decision changes it |
| `HUB_OWNER_PORTAL_ORIGIN` | One exact HTTPS origin, without a path, wildcard, or trailing slash | The verified live owner-portal origin only |

The controlled configuration helper also receives
`HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64`. This is the Base64URL SPKI public
key corresponding to the private JWK above. It is not a secret and is not
stored by the Function helper; it is supplied only so the helper can prove that
the private issuer key matches the public Android build-pinning value.

## Function configuration

| Function | `verify_jwt` | Caller boundary |
| --- | --- | --- |
| `hub-owner-enrollment` | `true` | Browser owner session JWT plus exact configured CORS origin |
| `hub-enrollment` | `false` | Native Hub signed proof and service-only RPC controls |
| `hub-staff-session` | `false` | Native Hub signed proof plus server-side PIN validation |
| `hub-staff-credential-reset` | `false` | Native Hub signed proof and one-time owner-issued reset code |
| `hub-sync` | `false` | Native Hub signed event batch and server-side authority checks |
| `hub-terminal-enrollment` | `false` | Native terminal signed proof and short-lived owner-issued code |
| `hub-terminal-staff-session` | `false` | Native terminal signed proof, active admission, and server-side PIN validation; deploy only after R014 is recorded |

`verify_jwt = false` is intentional only for native endpoints that already
validate their own signed device proof. It must never be copied to the browser
owner endpoint.

The current HOLD-preserving production configuration helper deploys only the
six functions compatible with the recorded R001A–R013 schema. It deliberately
does **not** deploy `hub-terminal-staff-session` yet: that receiver calls the
R014 service-only RPCs, and deploying it before the additive R014 migration is
recorded would create a false-ready endpoint. A future approved release may
deploy it after the exact migration ledger and Function configuration are both
re-verified.

## Auth hardening still required

Supabase Security Advisor currently reports that **leaked-password protection
is disabled**. Enable it in the project’s Auth password-security settings
before active owner onboarding. This setting is outside SQL migrations and
must be changed through the authorized Supabase project configuration path.

### Owner account signup configuration

Account signup is not fully configured merely because the R001 RPC exists.
Before active owner onboarding, set and record the following on the production
project:

1. Enable the Email/password provider and new-user signup.
2. Enable **Confirm email**.
3. Set the Auth Site URL to the exact HTTPS value used for
   `VITE_OWNER_PORTAL_ORIGIN` in the released browser build.
4. Add the exact origin and the exact `<origin>?auth=recovery` URL to the Auth
   Redirect URL allow-list. Do not use a wildcard for the production owner
   portal.
5. Configure and verify the confirmation and recovery email delivery path.
   The confirmation template must preserve `{{ .RedirectTo }}`; the recovery
   template returns to the same origin with the browser's `auth=recovery`
   presentation marker.
6. Enable leaked-password protection and a strong Auth password policy. The
   browser independently requires a 12-character minimum; the project policy
   must not weaken that floor.
7. Record a read-only screenshot/export of these settings with the released
   browser commit. Never record tokens, SMTP credentials, or user email
   addresses in the evidence file.

The source now blocks owner Auth unless `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, and the exact `VITE_OWNER_PORTAL_ORIGIN` are all
configured for the current portal. It uses the clean portal root for signup
confirmation and requires `email_confirmed_at` before the R001 foundation RPC.
These are source safeguards, not proof that the hosted Auth settings above have
been applied.

The advisor also reports the R001 owner bootstrap RPC as an authenticated
`SECURITY DEFINER` function. That is intentionally retained: it binds all new
business ownership to `auth.uid()` and is the approved R001 first-business
creation path. It should be re-tested with an authenticated non-owner and
unauthenticated caller before any release-status change.

## Guarded deployment sequence

1. Verify the live migration history against the exact production ledger.
2. In the secured deployment environment, supply the ledger SHA-256, the
   remote-comparison confirmation, and the exact controlled-configuration
   confirmation required by ADR-009.
3. Supply the five custom values through the secure Function secret store and
   the matching public SPKI value only for local key-pair verification.
4. Run `scripts/deploy-hub-cloud.sh --configure-production-functions`. It
   deploys no SQL and leaves product release status HOLD.
5. Build Android only with the matching **public** P-256 SPKI issuer map and
   Functions base URL; never include the private JWK.
6. Enable Auth leaked-password protection through the authorized project
   setting before active owner onboarding.
7. Prove each Function’s rejection and success paths on real hardware before
   activating operational use.

This manifest is configuration preparation, not a deployment approval.

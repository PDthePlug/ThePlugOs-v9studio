# ADR-007 — Modern Supabase API-key resolution for Hub receivers

- **Status:** Accepted source design; deployment remains HOLD
- **Date:** 27 August 2026
- **Applies to:** All Hub Edge receivers and `hub-owner-enrollment`
- **Authority:** Engineering Charter, Cloud Hub Receiver Contract, Supabase API-key migration guidance

## Context

The production project has an enabled modern publishable API key. Supabase now
provides Edge Functions with named `SUPABASE_PUBLISHABLE_KEYS` and
`SUPABASE_SECRET_KEYS` maps in addition to the legacy `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` variables. The legacy values remain compatible for
the current transition period, but using modern keys lets the project rotate a
backend credential without rotating its JWT signing secret.

The Hub receivers must keep their existing authority boundary:

- `hub-owner-enrollment` accepts a signed-in owner JWT and only the configured
  owner portal origin.
- Native endpoints perform their own device-proof validation and therefore
  intentionally keep platform `verify_jwt = false`.
- A secret API key is an internal Edge-to-Data-API credential only. It is never
  accepted from Android, the browser, a request body, a URL, or a log.

## Decision

1. All Edge Function clients resolve the named `default` modern key first:
   `SUPABASE_PUBLISHABLE_KEYS.default` for owner-authentication lookups and
   `SUPABASE_SECRET_KEYS.default` for service-only RPC clients.
2. Resolution is strict and fail-closed. A present but malformed key map, a map
   without a valid `default` value, or a value with the wrong key family fails
   configuration. The function must not silently fall back in that case.
3. A legacy key is used only if the corresponding modern map is absent or
   blank. This preserves a controlled transition for existing deployments; it
   does not make legacy keys a production configuration target.
4. Key maps are parsed by a pure shared resolver. The resolver has no request
   surface and reports no raw environment value in an error.
5. `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES` becomes an explicit deployment
   input. It must be an integer from 15 through 720, so a release cannot
   accidentally inherit the twelve-hour default when a tighter value was
   intended.
6. The release helper uploads only the five documented Edge Function
   secret-store values. It accepts the corresponding public SPKI only for a
   local private/public-key match check; it never stores that public value as a
   secret. ADR-009 defines the narrowly controlled production configuration
   path; it does not grant product-release authority.

## Consequences

- Functions will prefer rotatable `sb_publishable_...` and `sb_secret_...`
  values when the production secret store exposes them.
- The repository can still be verified locally without any secret material.
- The real project still needs one configured P-256 issuer key, rate-limit
  pepper, exact owner-portal origin, explicit bundle TTL, Android public issuer
  key map, and physical-device acceptance before the receivers can be deployed.

## Verification

The R016 cloud-configuration contract proves modern-key preference, strict
malformed-map rejection, legacy-only compatibility, function use of the shared
resolver, explicit TTL deployment validation, and the unchanged per-function
JWT configuration.

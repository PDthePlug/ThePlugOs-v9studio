# PASS 5C — Staging secret-material hardening evidence

- **Date:** 13 October 2026
- **Staging project ref:** `zwqnrxplbkzkzcpimpim`
- **Source candidate:** `16521a07c86842bd1f546e196d29c0cd189fc617`
- **GitHub Actions run:** `38365976878`
- **Release status:** **HOLD**
- **Result:** source/local secret generation **PASS**; Supabase secret provisioning **BLOCKED by connector capability**

## R031 source gate

PASS 5C adds a dedicated local-only staging secret-material generator and regression contract.

`script/generate-staging-secret-material.mjs` generates:

- a P-256 (`prime256v1`) issuer keypair;
- a bounded issuer key ID;
- a 32-byte random rate-limit pepper;
- a validated bundle TTL;
- a canonical bare HTTPS owner-portal origin.

The generator writes two local files with mode `0600` and refuses to overwrite either file:

- `.env.theplugos-staging.local` — private issuer JWK, rate-limit pepper and required Function settings;
- `.env.theplugos-staging.public` — issuer key ID, public JWK, public-key fingerprint, TTL and owner origin.

The private JWK and rate-limit pepper are not printed by the generator and are never committed.

R031 verifies:

- P-256 private/public JWK shape;
- private scalar isolation;
- rate-limit pepper length;
- mode `0600` on both output files;
- public handoff excludes the private scalar and pepper;
- stdout excludes private material;
- existing output files cannot be overwritten;
- non-HTTPS owner origins are rejected.

R031 is wired into `npm run test:all` after R030.

## CI seal

Run `38365976878` completed all three jobs successfully on source commit `16521a07c86842bd1f546e196d29c0cd189fc617`:

- `verify`: PASS — lint, R001–R031/full test chain, production web build;
- `journey-visual`: PASS;
- `android-debug`: PASS.

Artifacts:

| Evidence | Value |
| --- | --- |
| Journey artifact ID | `11796342961` |
| Journey archive SHA-256 | `6ae48b84df6049ff1e6d88c4d388f7b8533da651a7c6dd97f8712064c588d4fd` |
| Android artifact ID | `11796947961` |
| Android archive SHA-256 | `d5f283e21ea44cc2546f054d33f8d3719b0139c59b44d013c0ee18687ba0f742` |

## Real staging material generated

After the full CI seal passed, real staging issuer material was generated locally with the tested R031 generator for:

- owner origin `https://theplugos-v9studio.vercel.app`;
- bundle TTL `720` minutes;
- staging key label `theplugos-staging`.

Safe-to-record public identifiers:

- **Issuer key ID:** `theplugos-staging.20261013.718160683efd3232`
- **Public JWK SHA-256:** `718160683efd32328e39f9a18563b1385a20e02a595a8e9953176badcf77bcb2`

The private JWK and rate-limit pepper are intentionally absent from this evidence record.

## Supabase provisioning boundary

The connected Supabase tool surface exposes Function deployment but no project secret/environment-variable management action. Searches for both `secret` and `env` returned no supported action.

The reviewed cloud deployment contract requires these values to exist before Edge Function publication:

- `HUB_AUTHORIZATION_ISSUER_KEY_ID`
- `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`
- `HUB_RATE_LIMIT_PEPPER`
- `HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES`
- `HUB_OWNER_PORTAL_ORIGIN`

No Edge Function was intentionally deployed without them. A half-configured Function set would not satisfy staging acceptance and would weaken release evidence.

Therefore:

- local secret generation: **PASS**;
- private material isolation: **PASS**;
- Supabase secret provisioning: **BLOCKED — manual secure project-secret transfer required**;
- Edge Function deployment/invocation Gates D/G: **BLOCKED**;
- live terminal/sync Gates E/F: **BLOCKED**;
- overall release: **HOLD**.

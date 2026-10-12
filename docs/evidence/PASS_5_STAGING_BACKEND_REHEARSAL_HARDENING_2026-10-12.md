# PASS 5 — Staging backend rehearsal hardening evidence

- **Date:** 12 October 2026
- **Frozen source/preflight candidate:** `d3c55dc6d0c0ede02923d5c77464af2191498f69`
- **GitHub Actions run:** `38311195110`
- **Overall release status:** **HOLD** — source/preflight readiness only; remote staging acceptance not executed
- **Architecture:** ADR-020
- **Primary regression gate:** R030 staging backend rehearsal/cloud-boundary contract
- **Live acceptance protocol:** `docs/testing/STAGING_BACKEND_ACCEPTANCE.md`

## What this pass closed

PASS 5 closes the repository-side engineering required to rehearse the current ThePlugOS backend safely in a fresh, explicitly authorized staging-equivalent Supabase project without weakening production controls or fabricating backend evidence.

The pass found and corrected three deployment-process defects before any remote mutation occurred:

1. The previous staging mutation branch was reachable only through the final `--deploy` path, while `--deploy` required release status `APPROVED`. Because accepted staging evidence is itself required before approval, that created a circular release gate.
2. The previous staging command depended on a Supabase CLI `db push --project-ref` form that is not the current linked-project deployment path.
3. More importantly, normal numeric migration discovery would not include the canonical `001a_retire_unsupported_legacy_staff_pins.sql` source filename. A clean staging rehearsal based on migration discovery could therefore have looked successful while silently omitting credential retirement.

No production or unrelated Supabase project was mutated while correcting these defects.

## HOLD-safe staging rehearsal path

`scripts/deploy-hub-cloud.sh` now separates remote mutation into explicit authority windows:

- `--verify-source` — local/source verification only;
- `--rehearse-staging` — HOLD-preserving isolated staging evidence path;
- `--configure-production-functions` — HOLD-preserving production Function configuration against the recorded R001A–R013 production schema baseline; and
- `--deploy` — final production-only path requiring release status `APPROVED`.

The staging rehearsal path:

- requires `THEPLUGOS_DEPLOYMENT_ENV=staging`;
- requires the target ref to equal a separately supplied expected ref;
- refuses production project `iwbbwcaylpulcpvbfkdx`;
- refuses preserved contaminated legacy staging project `dpqtgfxovmiwzkiuzoya`;
- requires a reviewed exact Git commit and clean worktree;
- requires the supplied database URL to identify the same confirmed staging project;
- requires TLS certificate verification;
- requires an exact P-256 issuer private/public key match before remote publication;
- requires separate exact schema and rehearsal acknowledgements; and
- never changes `RELEASE_STATUS.md` or grants production release authority.

## Explicit schema applicator

Fresh staging uses `scripts/apply-staging-schema.mjs`, not Supabase CLI migration discovery.

The applicator refuses production, the contaminated legacy staging ref, and any target where canonical ThePlugOS objects already exist. It applies one transaction per source migration in this exact order:

`001 -> 001A -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 -> 012 -> 013 -> 014 -> 015`

A failed migration is rolled back and stops the rehearsal. The applicator does not rename the R001A source file or rewrite the immutable production migration ledger.

After the sequence, it verifies that the R014 terminal staff-session RPCs exist and that the R015 owner-control-plane policy state is present, including owner staff INSERT, owner catalog UPDATE, and absence of an authenticated staff UPDATE policy.

Schema verification must succeed before Function secrets are set or Function code is deployed.

## Edge Function authentication boundary

The reviewed configuration now explicitly contains exactly six custom native-proof receivers with platform JWT verification disabled:

1. `hub-enrollment`
2. `hub-staff-session`
3. `hub-staff-credential-reset`
4. `hub-sync`
5. `hub-terminal-enrollment`
6. `hub-terminal-staff-session`

Those receivers have no browser CORS surface and perform their own bounded native/device proof before service-only RPC authority is used.

`hub-owner-enrollment` remains the browser owner receiver with `verify_jwt=true`, followed by owner/business/branch authorization.

R016 and R030 both cover the current Function set. R030 fails if an additional `verify_jwt=false` receiver appears without explicit review.

## Production ledger boundary

The production evidence ledger remains the recorded immutable R001A–R013 baseline. R014 and R015 are source-only for production at this point.

The production deployment modes do not replay the database through `db push`. Until a separately accepted production schema-advance record includes R014/R015, `hub-terminal-staff-session` remains withheld from production publication because it depends on R014.

This PASS does not reinterpret the production baseline or convert staging mechanics into production authorization.

## Source verification evidence

The frozen candidate completed the complete source/SQL contract chain through new R030, TypeScript checking, unit/component tests, and production web build.

| Evidence | Value |
| --- | --- |
| Source commit | `d3c55dc6d0c0ede02923d5c77464af2191498f69` |
| GitHub Actions run | `38311195110` |
| `npm run lint` | PASS |
| `npm run test:all` | PASS — R001 through R030 plus browser authority, Android host, release-truth and unit/component tests |
| Production web build | PASS |

The successful run retained the established source-only release-truth anchors for Kitchen, Cashier, Manager, cloud acknowledgement and HOLD status rather than weakening older gates to accommodate new prose.

## Customer-journey regression evidence

PASS 5 changed no React application or Android operational-authority source. The existing complete customer journey was nevertheless rerun against the exact PASS 5 source commit.

| Evidence | Value |
| --- | --- |
| Journey artifact ID | `11774906688` |
| Artifact name | `theplugos-customer-journey-d3c55dc6d0c0ede02923d5c77464af2191498f69` |
| Artifact archive SHA-256 | `032d1c886afa765f4b70ec94041b74d2ea2b21c5538bc3c987e070d5a49a2879` |
| Result | PASS |

This remains fixture-only presentation evidence. It is not live Auth, RLS, Edge Function, PIN, pairing, LAN, or hardware evidence.

## Android regression package evidence

The same source commit completed Android debug-host assembly, checksum generation and artifact publication.

| Evidence | Value |
| --- | --- |
| Android artifact ID | `11774099409` |
| Artifact name | `theplugos-android-debug-d3c55dc6d0c0ede02923d5c77464af2191498f69` |
| Artifact archive SHA-256 | `16d0063383898d5a84ea79f5280a5520b00b721769665024e1e2f286694911e2` |
| `app-debug.apk` SHA-256 | `8e1fb047d3458b4e21b5e8a9f3207de1b6ee29d9fc60de858541d6bcb77f2332` |
| Result | Android `:app:assembleDebug` PASS; checksum PASS; artifact upload PASS |

The artifact was downloaded after CI. The APK was independently SHA-256 hashed and matched its CI sidecar exactly.

**This APK is regression/package evidence only.** It is not yet the physical staging-acceptance candidate because a physical acceptance build must be provisioned with the public issuer-key map and cloud Functions base URL belonging to the exact accepted staging environment.

## Current remote-backend boundary

The connected Supabase account used during this PASS does not expose the recorded ThePlugOS production project or an explicitly authorized isolated ThePlugOS staging project. Visible projects belonging to other applications were deliberately not substituted or mutated.

Therefore the following remain **BLOCKED / NOT EXECUTED**, not passed:

- actual empty-target schema application through R015;
- live owner/non-owner RLS positive and negative cases;
- live deployment and invocation of all seven Functions;
- live owner-origin/JWT authorization;
- live terminal R014 challenge/signature/PIN/session behavior;
- live same-staff terminal supersession through the cloud receiver;
- live `hub-sync` durable acknowledgements, outage/retry/restart behavior; and
- any staging-backed physical Android test.

The historical clean-staging project reference is not treated as current availability evidence. The current acceptance target must be explicitly connected/authorized and pass the empty-target preflight before mutation.

## Next live milestone

The next engineering action requiring an external environment is to connect or create an explicitly authorized isolated ThePlugOS staging-equivalent Supabase project and execute `docs/testing/STAGING_BACKEND_ACCEPTANCE.md` through the guarded `--rehearse-staging` path.

Creating a new paid project or resuming/mutating an existing project requires explicit environment/cost authorization. Until that happens, the correct system state is:

**PASS 5 source/preflight slice: CLOSED. Remote staging acceptance: BLOCKED. Overall release: HOLD.**

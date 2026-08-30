# R002 Migration Acceptance Contract

## Evidence tiers

| Tier | Environment | What it proves |
|---|---|---|
| T1 | Static contract checks | Required SQL objects, grants, and prohibited patterns exist or are absent. |
| T2 | PGlite isolated PostgreSQL | 001 → 002 DDL and core pgcrypto/RPC behavior execute in a disposable database. |
| T3 | Supabase staging clone | Supabase Auth helpers, PostgREST grants, RLS, RPC exposure, and live data shapes behave correctly. |
| T4 | Live R001 migration rehearsal | Backup, migration, rollback, and operator acceptance work against a production-equivalent copy. |
| T5 | Production acceptance | Authorized live migration and all R002 operator/device acceptance cases pass. |

Phase 1 can complete T1 and T2 only. It must not claim T3–T5.

## T1/T2 automated cases

1. Canonical R001 applies to an isolated database with Supabase-compatible
   test roles and Auth stubs.
2. A non-bcrypt legacy credential causes R002 to fail closed.
3. The failed migration does not null the R001 credential.
4. Structurally valid bcrypt credentials migrate into `staff_credentials`.
5. Migrated `staff_members.pin_hash` values become NULL only after safe copy.
6. Credential, session, and pairing-attempt tables reject browser-role reads.
7. Owner account authority can set an onboarding PIN.
8. The explicit service-role grant reaches its documented administration path.
9. Valid PIN succeeds; invalid PIN does not disclose staff existence.
10. Five invalid PIN attempts persist a five-minute lockout.
11. Lockout state survives a new database client/session.
12. Valid manager/owner login issues a short-lived security session.
13. A manager cannot modify OWNER credentials.
14. A manager cannot administer another branch.
15. Session revocation invalidates the delegated token.
16. Active six-digit pairing codes cannot collide across tenants.
17. Pairing codes are bcrypt-hashed, expiring, and single-use.
18. Five invalid pairing attempts persist a per-device lockout.
19. Device enrollment creates the exact business/branch binding.
20. Bootstrap data is branch-scoped and excludes credentials.
21. Manager device authority cannot cross a branch or business boundary.
22. Device revocation prevents status/bootstrap success.
23. Security audit event IDs remain unique under a burst test.
24. Intended anonymous RPC execution works without granting table reads.
25. Running the preflight on the migrated fixture reports no unsafe legacy
    credential values.

## Required T3 staging cases

These remain mandatory after Phase 1:

- Introspect the real pgcrypto namespace and execute every RPC through the
  Supabase client.
- Confirm anonymous/authenticated table access is denied while intended RPC
  execution remains available.
- Confirm `auth.uid()` owner onboarding authority with a real Supabase user.
- Confirm staff lockout across browser refresh and a second client.
- Confirm manager boundaries with separate branches.
- Confirm pairing throttle plus API-gateway/Edge Function rate limiting.
- Confirm current device-ID bootstrap risk is resolved before production.
- Confirm rollback from a restored backup.

## Phase 1 candidate rule

The R002 candidate may be committed to its isolated implementation branch when
all T1/T2 checks pass and the complete repository suite has been run. It may
not be merged or released while any repository test remains failed. A failure
outside the authorized Phase 1 boundary must be preserved as a named blocker,
not hidden by weakening the test or changing unrelated architecture.

The candidate remains explicitly **NOT APPROVED FOR LIVE MIGRATION** until T3
and T4 have passed under a separate authorization.

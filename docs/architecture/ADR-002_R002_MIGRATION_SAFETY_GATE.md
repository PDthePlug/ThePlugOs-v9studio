# ADR-002: R002 Migration Safety Gate

- **Status:** Accepted for Phase 1 implementation
- **Live deployment status:** NOT APPROVED
- **Date:** 2026-08-11
- **Decision owners:** ThePlugOS Engineering
- **Related migration:** `supabase/migrations/002_secure_identity_devices.sql`
- **Supersedes:** No prior ADR

## Context

The Backend Reality Audit found that R002 contains substantial staff-credential,
lockout, delegated-session, pairing, bootstrap, and revocation logic, but the
migration has not passed a live migration or acceptance gate. The current
source also contains migration risks that must be resolved before any live
execution:

1. Every non-bcrypt legacy `staff_members.pin_hash` is treated as a plaintext
   PIN and bcrypt-hashed. A client digest would therefore become an unusable
   bcrypt hash of the digest.
2. R002 functions use `SECURITY DEFINER SET search_path = ''` while calling
   unqualified pgcrypto functions. Runtime resolution depends on the extension
   schema of the target project.
3. The target R001 schema, roles, grants, credential formats, and partial R002
   state are not validated before destructive changes.
4. Security RPC audit IDs use a timestamp plus a small random suffix.
5. Staff security sessions have no database revocation primitive.
6. Anonymous six-digit pairing attempts have no persistent database throttle.
7. The repository has no executable migration integration harness.

The Constitution requires versioned migrations, explicit failure modes,
idempotency, branch awareness, tests before merge, and evidence before a
production claim.

## Decision

R002 will be hardened under a fail-closed migration gate.

### 1. Unsupported legacy credentials block migration

R002 may automatically carry forward only structurally valid bcrypt `$2a$` or
`$2b$` hashes. Any other nonempty legacy value blocks the migration with an
explicit error and remediation hint. It must never be interpreted as plaintext
automatically.

The live preflight reports only counts and staff identifiers. It never returns
credential values.

### 2. Pgcrypto calls use stable private wrappers

The migration discovers the installed pgcrypto schema from `pg_extension` and
creates schema-qualified wrappers in the existing `private` schema. Security
RPCs call only those private wrappers. The migration does not move an existing
extension and does not add a writable schema such as `public` to a
`SECURITY DEFINER` search path.

The wrappers are revoked from `PUBLIC`, `anon`, and `authenticated`.

### 3. R002 is self-checking and clone-tested

A read-only preflight contract verifies the exact R001 prerequisites and
detects partial R002 state before execution. A PostgreSQL-compatible PGlite
test harness applies 001 and 002 to an isolated database with pgcrypto enabled.
This harness is a fast repository gate, not a substitute for the required
Supabase staging clone.

### 4. Security state remains server-side

Credential hashes, lockout counters, pairing hashes, pairing-attempt counters,
and staff-session hashes remain inaccessible to browser roles. All state
changes occur through explicit RPCs.

### 5. Session and pairing failure modes become explicit

R002 adds:

- a session-token revocation RPC;
- persistent per-device pairing-attempt counters and lockout;
- transaction-serialized generation that prevents an active six-digit pairing
  code from colliding across tenants;
- collision-resistant security audit event IDs;
- exact privilege grants for every new table and RPC.

Per-device database throttling is defense in depth. An API-gateway/Edge
Function rate limit is still required before public production exposure,
because an attacker can rotate a caller-supplied device ID.

The anonymous PIN-verification route also remains dependent on the future
trusted-device boundary and source-aware gateway throttling. Persistent staff
lockout limits guessing but can otherwise be abused to deny service to a known
staff identity.

### 6. No live execution in Phase 1

Phase 1 ends with a candidate migration, automated evidence, a preflight
result contract, and a runbook. Applying R002 to staging or production requires
a separate authorization and the acceptance procedure in
`docs/testing/R002_MIGRATION_ACCEPTANCE.md`.

## Explicit non-goals

These audit findings are intentionally not redesigned in this ADR:

- device proof-of-possession and secure bootstrap replacement;
- full business/branch RLS redesign and composite tenant constraints;
- application role/session restoration changes;
- order, sync, realtime, inventory, or finance architecture;
- removal of legacy runtime services.

They remain open in the remediation register and block production readiness.

## Failure modes

| Failure | Required behavior |
|---|---|
| Unknown legacy PIN format | Abort before destructive credential cleanup. |
| Missing or incompatible R001 object | Abort with the missing contract named. |
| Pgcrypto unavailable or undiscoverable | Abort before RPC creation. |
| Partial R002 object has incompatible columns | Preflight blocks the gate. |
| Wrong staff PIN | Increment persistent counter under row lock. |
| Fifth consecutive wrong PIN | Persist five-minute lockout. |
| Wrong pairing code | Increment persistent per-device counter. |
| Fifth consecutive wrong pairing code | Persist five-minute pairing lockout. |
| Audit insert fails | Security transaction fails atomically; no false success. |
| No live authorization | Stop after local/clone evidence. |

## Consequences

### Positive

- Unknown R001 credential semantics can no longer silently lock out staff.
- Pgcrypto works independently of whether the extension is installed in
  `public`, `extensions`, or another discovered schema.
- The migration gains repeatable repository-level evidence.
- Session and pairing security primitives have complete server-side state.

### Cost

- A live database containing unsupported legacy PIN formats must complete a
  controlled credential reset or approved transformation before R002.
- PGlite adds a development-only dependency and approximately one megabyte of
  pgcrypto extension assets.
- Supabase-specific behavior still requires the staging-clone acceptance gate.

## Definition of done for Phase 1

1. R001 remains byte-for-byte unchanged.
2. Unsupported legacy credentials demonstrably block R002 without destructive
   effects.
3. A valid bcrypt R001 fixture migrates successfully.
4. Browser roles cannot select credential, session, or pairing-attempt hashes.
5. PIN verification, persistent lockout, session issue/revocation, delegated
   manager boundaries, pairing use-once behavior, pairing lockout, bootstrap,
   and revocation are covered by executable tests.
6. The complete pre-existing test suite, type-check, and production build run.
7. No Supabase project is changed.

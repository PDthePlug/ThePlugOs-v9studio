# R002 Migration Preflight and Rollback Runbook

## Safety statement

This runbook is not authorization to apply R002. Phase 1 produces a candidate
and evidence only.

The only exception is the separately recorded, owner-approved R001A→R012
remediation window in
`docs/evidence/CONTROLLED_PRODUCTION_REMEDIATION_2026-08-26.md`. That narrow
exception does not waive any backup, failure-stop, or evidence rule below, and
does not approve a product release.

## Preconditions for a future staging rehearsal

1. Take a verified logical backup and provider snapshot of the R001 database.
2. Restore that backup into an isolated Supabase staging project.
3. Record migration history, PostgreSQL version, extension namespaces, table
   definitions, constraints, policies, grants, functions, and row counts.
4. Deploy the exact application commit intended for the rehearsal.
5. Prevent real terminals from connecting to the staging clone.
6. Run `supabase/preflight/002_secure_identity_devices_preflight.sql` using a
   read-only transaction.
7. Stop if any blocker or unsupported credential is reported.

## Unsupported legacy credential remediation

Never export PIN values or hashes to a browser, log, ticket, or chat.

If the preflight identifies non-bcrypt values:

1. Determine the generating implementation and format from source/history.
2. If the original PIN can be securely verified server-side, create an
   explicitly reviewed one-time transformation migration.
3. Otherwise require an owner-controlled PIN reset before R002.
4. Re-run preflight until every nonempty legacy value is a supported bcrypt
   hash or NULL.

Do not enable a migration flag that interprets unknown values as plaintext.

## Staging execution

1. Record the candidate archive hash and Git commit.
2. Apply 002 using the normal versioned migration mechanism.
3. Capture the exact command result and duration.
4. Execute every T3 acceptance case from
   `docs/testing/R002_MIGRATION_ACCEPTANCE.md`.
5. Compare row counts and tenant/branch bindings before and after.
6. Verify credential/session/pairing tables cannot be selected by `anon` or
   `authenticated`.
7. Verify all intended RPC grants and all prohibited direct grants.
8. Verify trusted-device enforcement and source-aware rate limits in front of
   anonymous PIN verification and device pairing. Database lockout alone is
   not the public-edge control.
9. Treat any failed case as a migration failure; do not patch the database by
   hand.

## Rollback rehearsal

R002 is structurally destructive because it drops raw pairing codes and clears
legacy PIN columns after safe copy. Rollback is restoration, not an ad-hoc
reverse migration.

1. Stop application writes.
2. Preserve failure logs and the failed database for diagnosis.
3. Restore the verified pre-migration snapshot/backup into a fresh project or
   perform the provider-approved point-in-time restore.
4. validate R001 row counts, owner login, staff/catalog restoration, and PIN
   workspace entry.
5. Repoint only after validation.

## Production gate

Production execution requires all of the following:

- T1–T4 evidence attached to the release;
- zero unresolved R002 P0 findings;
- an approved maintenance window;
- named operator and rollback owner;
- tested backups and recovery time;
- explicit authorization to apply the live migration.

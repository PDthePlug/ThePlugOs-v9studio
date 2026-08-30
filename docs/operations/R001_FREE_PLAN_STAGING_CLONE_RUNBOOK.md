# R001 Free-plan staging clone runbook

## Status and safety boundary

This runbook prepares a manual logical clone from the accepted R001 Supabase
project into the manually created Free-plan project
`theplugos-r001-clean-staging` (`nuufscrmkfoukndfmwcc`). It is not authorization to
apply `002_secure_identity_devices.sql`.

Hard rules:

- Production is a read-only source. No migration, DDL, DML, Auth
  administration, password reset, project link, publication change, or
  configuration change is permitted there.
- Every source SQL session sets `default_transaction_read_only=on`; inventory
  queries also use an explicit `BEGIN READ ONLY` transaction.
- Only the project whose pooler username contains
  `nuufscrmkfoukndfmwcc` may receive writes.
- Use the Session Pooler on port `5432`. Do not use the transaction pooler on
  port `6543`.
- Do not place connection strings, passwords, API keys, SQL dumps, or raw
  validation output in the repository, chat, command history, or evidence
  report.
- A clone is not a PASS until the source and destination evidence described
  below agrees and R002 objects are absent.

## Known target

| Field | Required value |
|---|---|
| Project name | `theplugos-r001-clean-staging` |
| Project reference | `nuufscrmkfoukndfmwcc` |
| Pooler mode | Session |
| Pooler port | `5432` |
| Database | `postgres` |
| Pooler user | `postgres.nuufscrmkfoukndfmwcc` |

The source project reference and both projects' Session Pooler hostnames are
intentionally not recorded in this file.

## Credentials and access required

Configure these as environment variables in the engineering environment. Do
not use a committed `.env` file.

| Variable | Secret? | Purpose |
|---|---:|---|
| `THEPLUGOS_R001_SOURCE_PROJECT_REF` | No | Proves the source is not the staging target. |
| `THEPLUGOS_R001_SOURCE_POOLER_HOST` | No | Source IPv4 Session Pooler hostname copied from **Connect**. |
| `THEPLUGOS_R001_SOURCE_DB_PASSWORD` | Yes | Read-only dump connection. The session itself is forced read-only. |
| `THEPLUGOS_R001_STAGING_POOLER_HOST` | No | Destination IPv4 Session Pooler hostname copied from **Connect**. |
| `THEPLUGOS_R001_STAGING_DB_PASSWORD` | Yes | Staging restore and validation. |
| `VITE_SUPABASE_URL` | No | Must be `https://nuufscrmkfoukndfmwcc.supabase.co`. |
| `VITE_SUPABASE_ANON_KEY` | Public credential | Staging browser/Auth/PostgREST acceptance only. |

The database passwords are preferable to complete connection URIs: this
avoids URL-encoding errors and prevents a password-bearing URI from appearing
in a process argument. The operator constructs libpq settings in a subshell:

```bash
source_pg() (
  export PGHOST="$THEPLUGOS_R001_SOURCE_POOLER_HOST"
  export PGPORT=5432
  export PGUSER="postgres.$THEPLUGOS_R001_SOURCE_PROJECT_REF"
  export PGPASSWORD="$THEPLUGOS_R001_SOURCE_DB_PASSWORD"
  export PGDATABASE=postgres
  export PGSSLMODE=require
  export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0'
  exec "$@"
)

staging_pg() (
  export PGHOST="$THEPLUGOS_R001_STAGING_POOLER_HOST"
  export PGPORT=5432
  export PGUSER='postgres.nuufscrmkfoukndfmwcc'
  export PGPASSWORD="$THEPLUGOS_R001_STAGING_DB_PASSWORD"
  export PGDATABASE=postgres
  export PGSSLMODE=require
  exec "$@"
)
```

For the Supabase CLI dump command only, construct the percent-encoded source
URI in memory. This command produces no terminal output:

```bash
R001_SOURCE_SESSION_POOLER_URL="$(node <<'NODE'
const required = [
  'THEPLUGOS_R001_SOURCE_PROJECT_REF',
  'THEPLUGOS_R001_SOURCE_POOLER_HOST',
  'THEPLUGOS_R001_SOURCE_DB_PASSWORD',
]
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}
const url = new URL('postgresql://localhost/postgres')
url.username = `postgres.${process.env.THEPLUGOS_R001_SOURCE_PROJECT_REF}`
url.password = process.env.THEPLUGOS_R001_SOURCE_DB_PASSWORD
url.hostname = process.env.THEPLUGOS_R001_SOURCE_POOLER_HOST
url.port = '5432'
url.searchParams.set('sslmode', 'require')
process.stdout.write(url.toString())
NODE
)"
export R001_SOURCE_SESSION_POOLER_URL
```

Not required for this gate:

- production or staging `service_role` keys;
- the production JWT secret;
- a Supabase personal access token or CLI login;
- production owner email/password;
- migration 002 parameters.

If a later inventory proves that R001 depends on Storage object bytes or Edge
Functions, their transfer requires a separately approved, tightly scoped
credential step. That is not silently added to this database-clone operation.

## Toolchain

Pin the Supabase CLI at `2.113.0`. Use PostgreSQL's `pg_dump`, `pg_dumpall`, and
`psql`; the client major must be at least the source server major. Record all
four versions in the evidence report.

```bash
node --version
npm --version
env SUPABASE_HOME="$PWD/.supabase-operator" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 --version
pg_dump --version
pg_dumpall --version
psql --version
```

The current engineering container has Node and npm, but not Docker or the
PostgreSQL client binaries. Provision the PostgreSQL client in the environment
setup before execution. Do not add these operator binaries as application
dependencies.

## Source-to-destination method

The method follows Supabase's manual within-Supabase backup/restore process:

1. Read-only inventory and drift fingerprint on production.
2. Read-only emptiness/baseline inventory on staging.
3. Dump filtered roles, non-managed schema, and data from production.
4. Dump `supabase_migrations` separately.
5. Inspect and hash every dump before restore.
6. Restore roles, schema, and data into staging in one transaction with
   `ON_ERROR_STOP=1` and triggers disabled.
7. Restore migration history into staging using the appropriate empty-table
   branch described below.
8. Recreate only the source's required non-default extensions and Realtime
   publication membership in staging.
9. Compare source and destination structure/data fingerprints and verify R001
   invariants.
10. Perform owner-controlled Auth acceptance without sharing the owner's
    password.

The normal schema dump excludes Supabase-managed schemas such as `auth`,
`storage`, `realtime`, and `supabase_migrations`. The data dump intentionally
includes Auth and Storage table rows while excluding their managed migration
tables. Custom schema objects in `auth` or `storage` are handled as an explicit
comparison/remediation gate rather than overwriting Supabase-managed schemas.

## Exact preflight commands

Create an operator-only directory outside the repository. Dumps contain
merchant and Auth data.

```bash
umask 077
R001_CLONE_WORKDIR="$(mktemp -d /tmp/theplugos-r001-clone.XXXXXX)"
export R001_CLONE_WORKDIR
```

Validate target identity before any write:

```bash
test "$THEPLUGOS_R001_SOURCE_PROJECT_REF" != 'nuufscrmkfoukndfmwcc'
test "$THEPLUGOS_R001_SOURCE_POOLER_HOST" != "$THEPLUGOS_R001_STAGING_POOLER_HOST"
case "$THEPLUGOS_R001_SOURCE_POOLER_HOST" in *.pooler.supabase.com) ;; *) exit 41 ;; esac
case "$THEPLUGOS_R001_STAGING_POOLER_HOST" in *.pooler.supabase.com) ;; *) exit 42 ;; esac
```

Prove both identities, versions, SSL, and the source read-only setting:

```bash
source_pg psql --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command "BEGIN READ ONLY; SELECT current_database(), current_user, current_setting('transaction_read_only'), current_setting('server_version_num'), current_setting('ssl'); ROLLBACK;"

staging_pg psql --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command "BEGIN READ ONLY; SELECT current_database(), current_user, current_setting('transaction_read_only'), current_setting('server_version_num'), current_setting('ssl'); ROLLBACK;"
```

The source result must report `postgres`, a source pooler role, and
`transaction_read_only=on`. The destination user configured by the operator
must be exactly `postgres.nuufscrmkfoukndfmwcc`. Source and destination server
majors must be compatible, and the PostgreSQL client must not be older than
the source.

Capture the source and empty-staging fingerprints:

```bash
source_pg psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --file supabase/validation/r001_clone_fingerprint.sql \
  > "$R001_CLONE_WORKDIR/source.before.tsv"

staging_pg psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --file supabase/validation/r001_staging_empty_preflight.sql \
  > "$R001_CLONE_WORKDIR/staging.before.tsv"
```

Before restore, staging must have no R001 application tables, no Auth users,
no Storage buckets/object metadata, and no user migration-history rows. Stop
instead of truncating if it is not empty.

## Exact source dump commands

These are the pinned Supabase CLI commands used as the contract for dump
filtering. During execution they run with the source Session Pooler URI built
in memory from the environment variables, never committed or printed:

```bash
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0' \
  env SUPABASE_HOME="$R001_CLONE_WORKDIR/supabase-home" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 db dump --db-url "$R001_SOURCE_SESSION_POOLER_URL" \
  --file "$R001_CLONE_WORKDIR/roles.sql" --role-only

PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0' \
  env SUPABASE_HOME="$R001_CLONE_WORKDIR/supabase-home" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 db dump --db-url "$R001_SOURCE_SESSION_POOLER_URL" \
  --file "$R001_CLONE_WORKDIR/schema.sql"

PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0' \
  env SUPABASE_HOME="$R001_CLONE_WORKDIR/supabase-home" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 db dump --db-url "$R001_SOURCE_SESSION_POOLER_URL" \
  --file "$R001_CLONE_WORKDIR/data.sql" --use-copy --data-only \
  --exclude 'storage.buckets_vectors' \
  --exclude 'storage.vector_indexes'

PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0' \
  env SUPABASE_HOME="$R001_CLONE_WORKDIR/supabase-home" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 db dump --db-url "$R001_SOURCE_SESSION_POOLER_URL" \
  --file "$R001_CLONE_WORKDIR/history_schema.sql" \
  --schema supabase_migrations

PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0' \
  env SUPABASE_HOME="$R001_CLONE_WORKDIR/supabase-home" \
  SUPABASE_TELEMETRY_DISABLED=1 \
  npx --yes supabase@2.113.0 db dump --db-url "$R001_SOURCE_SESSION_POOLER_URL" \
  --file "$R001_CLONE_WORKDIR/history_data.sql" --use-copy --data-only \
  --schema supabase_migrations
```

`supabase db dump` invokes PostgreSQL dump tooling and performs only catalog
and table reads on the source. For this environment, if Docker is unavailable,
the pinned CLI's `--dry-run` output is locked into
`scripts/dump-r001-production-readonly.sh` and executed with installed native
PostgreSQL clients:

```bash
bash scripts/dump-r001-production-readonly.sh
```

No filters may be improvised. The script has no staging connection and forces
every source connection into read-only mode.

Inspect before restore:

```bash
sha256sum "$R001_CLONE_WORKDIR"/*.sql > "$R001_CLONE_WORKDIR/dump.sha256"
node scripts/inspect-r001-schema-dump.mjs "$R001_CLONE_WORKDIR/schema.sql"
```

The statement-aware inspector is required. It ignores SQL-like text in
comments, literals, quoted identifiers, nested comments, and dollar-quoted
function bodies, but rejects executable destructive/DML statements, CTE-hidden
DML, and every R002 identifier. It fails closed on unterminated or ambiguous
SQL. Do not replace it with a broad grep expression: R001 function bodies can
legitimately contain DML and must not be misclassified as top-level restore
SQL.

The data dump legitimately contains `COPY` statements. Its contents must not
be displayed in logs or included in evidence.

Run the source fingerprint a second time immediately after the dump:

```bash
source_pg psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --file supabase/validation/r001_clone_fingerprint.sql \
  > "$R001_CLONE_WORKDIR/source.after.tsv"
```

If the structural or R001 data portions of `source.before.tsv` and
`source.after.tsv` differ, production changed during capture. Stop and repeat
during a quiet window; do not write to production to obtain consistency.

## Exact staging restore commands

This is the first database write in the procedure. Reconfirm the destination
pooler username before running it.

```bash
staging_pg psql \
  --no-psqlrc \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$R001_CLONE_WORKDIR/roles.sql" \
  --file "$R001_CLONE_WORKDIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$R001_CLONE_WORKDIR/data.sql"
```

This transaction writes roles allowed by Supabase's filtered role dump,
application schemas/tables/functions/policies/indexes/triggers, Auth and
Storage metadata rows, and application data to staging. Any SQL error causes
the transaction to roll back.

Migration history is restored separately because a fresh project may already
contain an empty `supabase_migrations.schema_migrations` table:

- if the table is absent, restore `history_schema.sql` and `history_data.sql`
  together in one transaction;
- if it exists, prove its columns/constraints match the source and it has zero
  rows, then restore only `history_data.sql`;
- if it contains rows or its contract differs, stop. Do not truncate or patch
  it by hand.

Absent-table command:

```bash
staging_pg psql --no-psqlrc --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$R001_CLONE_WORKDIR/history_schema.sql" \
  --file "$R001_CLONE_WORKDIR/history_data.sql"
```

Existing-empty-compatible-table command:

```bash
staging_pg psql --no-psqlrc --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$R001_CLONE_WORKDIR/history_data.sql"
```

Do not apply `supabase/migrations/002_secure_identity_devices.sql` in either
branch.

## Staging-only follow-up writes

The following are not performed blindly:

1. Enable on staging each source non-default extension required by an R001
   object, at a supported version and schema.
2. Restore the source's `supabase_realtime` publication membership for R001
   public tables. The schema dump intentionally excludes the publication.
3. Recreate reviewed custom triggers/policies/functions in `auth` or `storage`
   only when the source-vs-fresh-project comparison proves they are custom and
   required.
4. Configure staging Auth and other managed settings from the dashboard
   checklist below.

Every statement in this section is executed only through `staging_pg`; none is
run through `source_pg`.

## Supabase-managed state not cloned automatically

| Area | What the logical database operation does | What remains manual |
|---|---|---|
| Auth rows | Copies `auth` table data, including users, identities, and password hashes, subject to dump inspection. | Providers, Site URL, redirect allow-list, SMTP, email/SMS templates, CAPTCHA, hooks, rate limits, SSO/MFA settings, and other dashboard Auth configuration. |
| JWT/API keys | Does not copy project JWT secrets or API keys. | Keep the staging JWT secret and staging anon/service keys. Do **not** reuse the production JWT secret. Existing production tokens must be invalid in staging; users log in again. |
| Realtime | Does not recreate `supabase_realtime` publication membership. | Re-enable exactly the required source tables and verify RLS/filters. BroadcastChannel is unrelated. |
| Storage metadata | Database rows for buckets/objects can be present in the data dump. | Stored file bytes are not copied; bucket settings and custom managed-schema changes require verification. Nonzero object metadata with missing bytes blocks a faithful-clone verdict. |
| `auth`/`storage` custom schema | Normal schema dump excludes these managed schemas. | Compare and separately recreate required custom triggers, RLS policies, or functions. |
| Edge Functions | No code deployment is copied. | Function source/deployments, import maps or `deno.json`, routing, verification settings, and secrets. |
| Function/project secrets | Not copied. | Recreate staging-specific secrets; never copy a production secret unless separately reviewed and explicitly necessary. |
| Webhooks/external integrations | Managed enablement and external destinations are not reliably reproduced. | Re-enable only after retargeting to staging-safe endpoints. Keep production endpoints disabled. |
| Scheduled jobs | `cron` is excluded by the normal dump. | Recreate reviewed `pg_cron` jobs with staging-safe destinations/timing. |
| Vault/encrypted columns | `vault` is excluded and a manual project does not automatically share the source encryption root key. | If inventory finds Vault or encrypted-column use, stop and use Supabase's supported key procedure; do not improvise or expose keys. |
| Extensions | Managed/default state is project-specific. | Enable required non-default extensions before dependent objects are restored. |
| Database settings | Project compute, pooler, network restrictions, backups, custom domains, read replicas, and dashboard settings are not cloned. | Configure independently for staging. |
| Migration history | Excluded from the normal data dump. | Restore and compare `supabase_migrations` separately. |
| Storage/Function logs and operational history | Not cloned as deployable state. | Treat as source evidence only, not staging configuration. |

The repository currently contains no `supabase/functions` deployment and no
application Storage API call. That reduces the expected R001 scope, but the
live source inventory remains authoritative.

## Validation and PASS gate

After restore and reviewed staging-only configuration:

```bash
staging_pg psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --file supabase/validation/r001_clone_fingerprint.sql \
  > "$R001_CLONE_WORKDIR/staging.after.tsv"
```

Validation evidence must establish:

1. Source and destination PostgreSQL major compatibility and SSL connections.
2. Matching required extensions and extension schemas/versions.
3. Exact R001 application schemas, tables, columns, defaults, constraints,
   sequences, functions/RPC signatures and definitions, grants, RLS flags and
   policies, triggers, and indexes.
4. Matching R001 migration-history rows; no 002 history entry.
5. Matching counts and deterministic, non-reversible row fingerprints for:
   `businesses`, `business_memberships`, `branches`, `devices`,
   `staff_members`, `catalog_products`, `orders`, `order_items`,
   `device_pairing_codes`, and `audit_logs`.
6. Matching `auth.users` and `auth.identities` counts/fingerprints without
   displaying emails, password hashes, tokens, or user metadata.
7. No orphaned owner, membership, branch, staff, catalog, order, pairing, or
   audit-log relationships.
8. Representative accepted R001 data exists: at least one owner business,
   owner membership, branch, staff member, and catalog product. Evidence uses
   counts and redacted fingerprints, not merchant names or IDs.
9. Source-required Realtime publication membership is present in staging.
10. No R002 tables or functions exist, including `staff_credentials`,
    `staff_security_sessions`, `device_pairing_attempts`, `verify_staff_pin`,
    `pair_device_with_code`, or `get_device_bootstrap`.
11. The owner can authenticate against staging with the existing password,
    receives a staging-signed session, reloads accepted R001 branch/staff/
    catalog data from cloud state, and enters the R001 PIN workspace. The owner
    enters the password personally; it is never supplied to engineering.

Differences in Supabase-managed internal schema versions are documented and
assessed, not hidden by a blanket directory diff. Any difference affecting
R001 Auth, RLS, RPC, Realtime, or persisted data fails the gate.

## Rollback/reset

- A failure inside the primary `--single-transaction` restore automatically
  rolls back that restore. Production needs no rollback because it receives no
  writes.
- A failure after a committed restore can leave staging partially configured.
  Do not repair a supposedly production-equivalent clone with ad hoc
  `TRUNCATE`, `DROP SCHEMA`, or migration-history edits.
- The clean Free-plan reset is to delete **only** the staging project after
  explicit owner approval, create a new empty staging project, and repeat this
  runbook with its new project reference and credentials. Never delete or
  reset the source project.
- SQL dumps and raw fingerprints are sensitive temporary artifacts. After the
  evidence report is produced, delete the explicit
  `/tmp/theplugos-r001-clone.*` directory and remove the configured database
  passwords from the engineering environment. Rotate a password if exposure
  is suspected.

## Evidence report template

The report must contain:

- timestamp, source and destination project references (no secrets), tool
  versions, and Git commit;
- read-only source proof and staging-target proof;
- dump SHA-256 values without the dumps;
- schema/object comparison;
- functions/RPCs, RLS/policies, extensions, triggers/indexes, grants, and
  Realtime publication comparison;
- redacted row counts/fingerprints and R001 relational-invariant results;
- Auth user/identity parity and staging-token implications;
- all failures/discrepancies and their disposition;
- owner-controlled Auth/cloud-restoration acceptance result;
- explicit `R001 STAGING CLONE: PASS` or `R001 STAGING CLONE: FAIL`.

R002 remains blocked unless every required item passes.

## References

- [Supabase: Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase: Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: Migrating Auth users between projects](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Supabase: Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

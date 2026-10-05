#!/usr/bin/env bash

# Docker-free equivalent of the dump scripts emitted by:
#   supabase@2.113.0 db dump --dry-run
#
# This script has no destination connection and cannot write to staging. Every
# source connection is forced read-only. It writes sensitive logical dumps only
# to a newly created, operator-supplied /tmp/theplugos-r001-clone.* directory.

set -Eeuo pipefail
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly STAGING_PROJECT_REF='nuufscrmkfoukndfmwcc'
readonly INTERNAL_SCHEMAS='information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
readonly DATA_EXCLUDED_SCHEMAS='information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor'

required_variables=(
  R001_CLONE_WORKDIR
  THEPLUGOS_R001_SOURCE_PROJECT_REF
  THEPLUGOS_R001_SOURCE_POOLER_HOST
  THEPLUGOS_R001_SOURCE_DB_PASSWORD
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable_name" >&2
    exit 31
  fi
done

if [[ "$THEPLUGOS_R001_SOURCE_PROJECT_REF" == "$STAGING_PROJECT_REF" ]]; then
  printf 'Refusing to treat the staging project as the R001 source.\n' >&2
  exit 32
fi

case "$THEPLUGOS_R001_SOURCE_POOLER_HOST" in
  *.pooler.supabase.com) ;;
  *)
    printf 'Source host is not a Supabase pooler hostname.\n' >&2
    exit 33
    ;;
esac

case "$R001_CLONE_WORKDIR" in
  /tmp/theplugos-r001-clone.*) ;;
  *)
    printf 'R001_CLONE_WORKDIR must be a dedicated /tmp/theplugos-r001-clone.* directory.\n' >&2
    exit 34
    ;;
esac

if [[ ! -d "$R001_CLONE_WORKDIR" ]]; then
  printf 'R001_CLONE_WORKDIR does not exist.\n' >&2
  exit 35
fi

for command_name in node pg_dump pg_dumpall sed uniq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 36
  fi
done

dump_files=(
  roles.sql
  schema.sql
  data.sql
  history_schema.sql
  history_data.sql
)

for dump_file in "${dump_files[@]}"; do
  if [[ -e "$R001_CLONE_WORKDIR/$dump_file" ]]; then
    printf 'Refusing to overwrite existing dump artifact: %s\n' "$dump_file" >&2
    exit 37
  fi
done

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

filter_role_dump() {
  sed -E 's/^\\(un)?restrict .*$/-- &/' |
    sed -E 's/^CREATE ROLE "(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)"/-- &/' |
    sed -E 's/^ALTER ROLE "(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)"/-- &/' |
    sed -E 's/ (NOSUPERUSER|NOREPLICATION)//g' |
    sed -E 's/^-- (.* SET "(pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing)" .*)/\1/' |
    sed -E 's/GRANT ".*" TO "(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)"/-- &/' |
    sed -E '/^--/d' |
    uniq
}

filter_schema_dump() {
  local excluded_schema_pattern="${1:-$INTERNAL_SCHEMAS}"
  sed -E 's/^\\(un)?restrict .*$/-- &/' |
    sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' |
    sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' |
    sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' |
    sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' |
    sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' |
    sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' |
    sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' |
    sed -E 's/^CREATE EVENT TRIGGER /-- &/' |
    sed -E 's/^         WHEN TAG IN /-- &/' |
    sed -E 's/^   EXECUTE FUNCTION /-- &/' |
    sed -E 's/^ALTER EVENT TRIGGER /-- &/' |
    sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' |
    sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' |
    sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' |
    sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' |
    sed -E "s/^GRANT (.+) ON (.+) \"($excluded_schema_pattern)\"/-- &/" |
    sed -E "s/^REVOKE (.+) ON (.+) \"($excluded_schema_pattern)\"/-- &/" |
    sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' |
    sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' |
    sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' |
    sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' |
    sed -E 's/^CREATE POLICY "cron_job_/-- &/' |
    sed -E 's/^ALTER TABLE "cron"/-- &/' |
    sed -E 's/^SET transaction_timeout = 0;/-- &/' |
    sed -E '/^--/d'
}

filter_data_dump() {
  # Do not remove SQL comments: a multiline record can begin with one.
  sed -E 's/^\\(un)?restrict .*$/-- &/'
}

source_pg pg_dumpall \
  --roles-only \
  --role postgres \
  --quote-all-identifiers \
  --no-role-passwords \
  --no-comments |
  filter_role_dump > "$R001_CLONE_WORKDIR/roles.sql"
printf 'RESET ALL;\n' >> "$R001_CLONE_WORKDIR/roles.sql"

source_pg pg_dump \
  --schema-only \
  --quote-all-identifiers \
  --role postgres \
  --exclude-schema "$INTERNAL_SCHEMAS" |
  filter_schema_dump > "$R001_CLONE_WORKDIR/schema.sql"

{
  printf 'SET session_replication_role = replica;\n\n'
  source_pg pg_dump \
    --data-only \
    --quote-all-identifiers \
    --role postgres \
    --exclude-schema "$DATA_EXCLUDED_SCHEMAS" \
    --exclude-table auth.schema_migrations \
    --exclude-table storage.migrations \
    --exclude-table supabase_functions.migrations \
    --schema '*' \
    --exclude-table 'storage.buckets_vectors' \
    --exclude-table 'storage.vector_indexes' |
    filter_data_dump
  printf 'RESET ALL;\n'
} > "$R001_CLONE_WORKDIR/data.sql"

source_pg pg_dump \
  --schema-only \
  --quote-all-identifiers \
  --role postgres \
  --schema supabase_migrations |
  filter_schema_dump '__supabase_cli_empty_exclusion__' > "$R001_CLONE_WORKDIR/history_schema.sql"

{
  printf 'SET session_replication_role = replica;\n\n'
  source_pg pg_dump \
    --data-only \
    --quote-all-identifiers \
    --role postgres \
    --exclude-table auth.schema_migrations \
    --exclude-table storage.migrations \
    --exclude-table supabase_functions.migrations \
    --schema supabase_migrations |
    filter_data_dump
  printf 'RESET ALL;\n'
} > "$R001_CLONE_WORKDIR/history_data.sql"

node "$SCRIPT_DIR/inspect-r001-schema-dump.mjs" "$R001_CLONE_WORKDIR/schema.sql"

printf 'R001 read-only source dumps created in the protected operator directory.\n'

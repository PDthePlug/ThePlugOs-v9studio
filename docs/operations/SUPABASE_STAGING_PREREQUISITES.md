# Supabase R001 Staging Prerequisites

## Safety boundary

The staging target must be isolated from production and restored from the
accepted R001 state. Do not apply R002 to production. Creating the staging
target is not authorization to run R002; the migration remains gated by the
R002 preflight and T3/T4 acceptance contract.

## Preferred staging creation

Create a new Supabase project by using **Restore to a New Project** from a
verified backup taken at the accepted R001 state. This is preferred because it
preserves the database and Auth records in an independent project. Supabase's
clone operation is database-only, so the dashboard configuration listed below
must still be recreated and verified.

If Restore to a New Project is unavailable, create a new isolated Supabase
project and restore a verified R001 logical backup using Supabase's supported
backup/restore process. The schema dump omits managed schemas such as Auth and
Storage while the data dump can include their table rows; neither operation
copies all managed configuration or Storage object bytes. Follow
`docs/operations/R001_FREE_PLAN_STAGING_CLONE_RUNBOOK.md` for the exact
Free-plan procedure and equivalence gate.

Do not use a data-less preview branch as proof of production-equivalent R001
behavior.

## Access required by engineering

Supply access through an approved secret manager or connected Supabase
integration, never by pasting secrets into chat.

| Item | Required? | Purpose |
|---|---:|---|
| Staging project reference | Yes | Link CLI and record the exact isolated target. |
| `VITE_SUPABASE_URL` | Yes | Browser Auth, PostgREST, RPC, and Realtime endpoint. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Browser acceptance under real anon/authenticated roles. |
| Supabase CLI authentication | Yes for T3/T4 | Inspect migration state, link the staging project, and run the approved rehearsal. |
| Staging database password or secure direct connection | Yes for T3/T4 | Preflight, schema introspection, backup verification, and migration evidence. |
| Staging service-role access | Yes for T3 administration cases | Exercise the explicitly documented service-role path and inspect denied browser access. Never expose it to Vite/client code. |
| Production service-role key | No | It is neither requested nor permitted for this staging exercise. |

Use a staging-scoped Supabase personal access token for CLI automation where
possible. Keep the database password, token, and service-role key in server-side
secret storage only.

## Dashboard configuration to recreate and verify

1. **Auth**: enable the accepted R001 email/password provider; configure Site
   URL and redirect allow-list for the staging deployment plus
   `http://localhost:3000` and `http://localhost:5173`; disable production-only
   hooks or outbound templates until reviewed.
2. **Auth data**: confirm the cloned owner user and identity records exist, but
   do not send real customer email/SMS from staging.
3. **Database**: confirm the accepted R001 migration history, row counts, RLS,
   grants, functions, PostgreSQL version, and `pgcrypto` availability before
   R002 preflight.
4. **Realtime**: enable Postgres Changes for `public.orders`,
   `public.catalog_products`, and `public.staff_members` in the
   `supabase_realtime` publication. These are the tables the current
   `SyncService` subscribes to. Verify tenant/branch filtering behavior during
   T3; publication alone is not authorization.
5. **API keys**: use the new staging project's keys. Cloned/source project keys
   must not be reused.
6. **External effects**: disable or retarget database webhooks, `pg_net`,
   `pg_cron`, wrappers, Edge Functions, third-party integrations, and outbound
   notifications before allowing staging writes.
7. **Storage/Functions**: recreate only the buckets, policies, Edge Function
   deployments, and secrets actually required by the accepted R001 behavior;
   they are not restored by a database-only clone.
8. **Isolation**: do not connect real merchant terminals, production domains,
   production webhooks, or production credentials to staging.

## Engineering actions after access is connected

Engineering can perform the remaining work with no further database copying by
the owner:

1. Link only the staging project and record its project reference.
2. Capture the R001 schema/migration inventory and backup evidence.
3. Run the R002 read-only preflight and stop on any blocker.
4. Execute the separately authorized R002 rehearsal on staging.
5. Run every T3/T4 case, including Auth/RLS/RPC/Realtime, persistent lockout,
   branch boundaries, device flows, and backup restoration.
6. Preserve evidence and leave production untouched.

References: [Supabase Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project),
[Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[Supabase environment management](https://supabase.com/docs/guides/deployment/managing-environments),
[Supabase branching](https://supabase.com/docs/guides/deployment/branching), and
[Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

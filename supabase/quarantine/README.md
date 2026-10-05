# Quarantined Supabase artifacts

Files in this directory are retained only to explain historical repository
drift. They are not migration inputs, seed files, schema snapshots, or release
documentation.

`legacy-browser-prototype-schema.sql` is intentionally outside
`supabase/migrations/` and must not be applied to any environment. The ordered
migration chain and its preflight scripts are the only database deployment
inputs.

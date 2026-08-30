# ADR-008 — Production migration ledger and Function-deployment guard

- **Status:** Accepted source design
- **Date:** 27 August 2026
- **Applies to:** Production project `iwbbwcaylpulcpvbfkdx`, R001A–R013, and
  the Hub Function release helper
- **Authority:** Engineering Charter, controlled production-remediation record

## Context

R001A through R013 were applied to the live project through managed migration
operations. Supabase recorded generated history versions such as
`20260826145405`, while the canonical source files retain their approved short
R001A–R013 filenames. Renaming committed migration files or asking the CLI to
blindly run `db push` would make two independent histories appear outstanding
and could attempt duplicate DDL against the live schema.

The production schema is already present; the next permissible cloud action is
Function configuration and deployment, not replaying a database baseline.

## Decision

1. Record the live R001A–R013 history in a source-controlled migration ledger
   with the corresponding canonical file SHA-256 values.
2. The Hub Function deployment helper validates that ledger and requires its
   exact SHA-256 acknowledgement before it can deploy Functions.
3. The helper **must not run `supabase db push`** against this production
   baseline. The existing migration files are immutable and must never be
   renamed merely to match generated remote history versions.
4. Every future schema change must have a new managed migration identity,
   source hash, remote result, and ledger entry before it is eligible for a
   Function deployment that depends on it.
5. A source-verified ledger does not replace a remote comparison. The release
   operator must verify the remote history against the ledger immediately
   before supplying the acknowledgement; missing, extra, or changed records
   stop the release.
6. ADR-009 may configure the six reviewed Functions in a narrowly controlled
   production window while product release remains HOLD. It uses the same
   remote-ledger acknowledgement and never executes `db push`.

## Consequences

- The already-applied R001A–R013 baseline cannot be replayed accidentally by
  a Function deployment.
- Function deployment remains fail-closed if the repository migration source
  changes after the ledger was issued.
- Database and Function releases now have separate explicit gates. A controlled
  Function configuration still does not change `RELEASE_STATUS.md` or grant
  production-operation authority.

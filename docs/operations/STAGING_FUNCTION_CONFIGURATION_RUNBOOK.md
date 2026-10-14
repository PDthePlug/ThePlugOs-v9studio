# ThePlugOS staging Function configuration runbook

- **Environment:** isolated ThePlugOS staging only
- **Active staging project:** `zwqnrxplbkzkzcpimpim`
- **Release status:** HOLD
- **Purpose:** securely provision ThePlugOS-owned Edge Function secrets and deploy the seven reviewed staging receivers **without replaying schema migrations**
- **Guarded command:** `scripts/deploy-hub-cloud.sh --configure-staging-functions`

This runbook starts **after** the accepted R001 → R001A → R016 staging schema rehearsal. The active staging database is no longer an empty target. Do not use `--rehearse-staging` on it.

## 1. Security boundary

Perform these steps only in a secure operator environment that can:

- access the exact ThePlug Supabase staging project;
- hold `SUPABASE_ACCESS_TOKEN` and the staging database URL without printing them;
- run the Supabase CLI;
- create local mode-`0600` secret files; and
- keep shell history, CI logs, screenshots and support transcripts free of secret values.

Do not place any of the following in GitHub, ChatGPT, browser storage, Android resources, screenshots or evidence documents:

- `HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON`;
- `HUB_RATE_LIMIT_PEPPER`;
- `SUPABASE_ACCESS_TOKEN`;
- database passwords;
- Supabase service/secret keys.

Only public identifiers/fingerprints belong in acceptance evidence.

## 2. Start from the reviewed source

```bash
git checkout main
git pull --ff-only
git status --porcelain
```

The working tree must be clean. Record, but do not manually invent, the checked source:

```bash
export THEPLUGOS_RELEASE_COMMIT="$(git rev-parse HEAD)"
```

The deploy helper refuses a dirty tree or a release-commit mismatch.

## 3. Generate the final staging issuer material

Generate the **final** staging pair in this same secure environment. Do not reuse the earlier unprovisioned PASS 5C rehearsal pair; that pair predates the SPKI handoff contract and was never installed in Supabase.

Choose a secure directory outside any shared/synced repository location, then run:

```bash
mkdir -p "$HOME/.theplugos/staging"
npm run generate:staging-secrets -- \
  --out-dir "$HOME/.theplugos/staging" \
  --owner-origin "https://theplugos-v9studio.vercel.app" \
  --ttl-minutes 720 \
  --key-label theplugos-staging
```

The generator creates, with mode `0600` and fail-on-overwrite behavior:

- `.env.theplugos-staging.local` — private JWK + pepper + non-secret configuration;
- `.env.theplugos-staging.public` — key ID + SPKI public key + public JWK + safe fingerprints.

It does not print the private JWK or pepper.

Load both files into the secure shell without echoing them:

```bash
set -a
source "$HOME/.theplugos/staging/.env.theplugos-staging.local"
source "$HOME/.theplugos/staging/.env.theplugos-staging.public"
set +a
```

## 4. Bind the exact staging project

Set only the non-secret environment identity values directly:

```bash
export THEPLUGOS_DEPLOYMENT_ENV=staging
export SUPABASE_PROJECT_REF=zwqnrxplbkzkzcpimpim
export THEPLUGOS_EXPECTED_PROJECT_REF=zwqnrxplbkzkzcpimpim
```

Inject these **secret** values from the operator's secure credential store; do not type their values into evidence or chat:

```text
SUPABASE_ACCESS_TOKEN
THEPLUGOS_STAGING_DATABASE_URL
```

The database URL must identify `zwqnrxplbkzkzcpimpim` in its hostname or username and must use PostgreSQL over verified TLS.

## 5. Verify the generated issuer pair

Run the same verifier used by the guarded deploy path:

```bash
issuer_fingerprint="$(node scripts/verify-issuer-key-configuration.mjs --emit-fingerprint)"
printf 'Issuer configuration fingerprint: %s\n' "$issuer_fingerprint"
```

The output is a non-secret 64-character SHA-256 fingerprint binding the key ID to the generated P-256 SPKI public key. Record only this fingerprint and the issuer key ID in evidence.

If verification fails, stop. Do not manually substitute or convert key material.

## 6. Verify the already-live staging schema read-only

Run:

```bash
staging_schema_fingerprint="$(node scripts/verify-staging-schema-state.mjs \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --emit-fingerprint)"
printf 'Staging schema fingerprint: %s\n' "$staging_schema_fingerprint"
```

This verifier is read-only. It requires the exact R001 → R001A → R016 migration-name order and checks the R014 service-only RPC boundary, R015 owner policies and R016 indexes.

If the ledger or authority state differs, stop. Do not repair the database from this configuration window.

## 7. Construct the exact staging configuration acknowledgement

The acknowledgement must bind project, reviewed source, live schema and issuer pair:

```bash
export THEPLUGOS_STAGING_FUNCTION_CONFIGURATION_CONFIRM="configure-functions:staging:${SUPABASE_PROJECT_REF}:${THEPLUGOS_RELEASE_COMMIT}:${staging_schema_fingerprint}:${issuer_fingerprint}"
```

Do not hand-edit this value.

## 8. Configure secrets and deploy all seven staging receivers

Run exactly:

```bash
scripts/deploy-hub-cloud.sh --configure-staging-functions
```

This mode must:

1. run the repository source gates;
2. keep release status HOLD;
3. confirm staging, never production;
4. verify the private JWK/SPKI pair;
5. re-run the read-only R001–R016 staging verifier;
6. require the exact acknowledgement above;
7. execute **no schema migration SQL**;
8. run `supabase secrets set` for the ThePlugOS-owned Function secrets; and
9. deploy all seven reviewed receivers:
   - `hub-enrollment`
   - `hub-owner-enrollment`
   - `hub-terminal-enrollment`
   - `hub-staff-session`
   - `hub-staff-credential-reset`
   - `hub-sync`
   - `hub-terminal-staff-session`

The six native-proof receivers retain `verify_jwt=false` because they implement their reviewed signed native proof. `hub-owner-enrollment` retains `verify_jwt=true` for the authenticated browser owner path.

## 9. Post-deployment evidence

After the guarded command succeeds, record only non-secret evidence:

- project ref `zwqnrxplbkzkzcpimpim`;
- source commit;
- green GitHub Actions run for that source;
- live staging schema fingerprint;
- issuer key ID;
- issuer configuration fingerprint;
- owner portal origin;
- Function names, versions/identifiers and deployment timestamps;
- `verify_jwt` mode for each Function;
- redacted positive/negative invocation results.

Never record raw JWTs, private JWK, pepper, access token, database URL password or service secret.

## 10. Required negative checks before Gate D/G can pass

Deployment alone is not acceptance. Measure at minimum:

- owner Function rejects missing/invalid JWT and wrong owner/business/branch scope;
- owner Function rejects any `Origin` other than `https://theplugos-v9studio.vercel.app`;
- every native-proof receiver rejects browser-origin requests;
- unsigned/malformed native requests fail before durable authority mutation;
- wrong signing keys/signatures fail closed;
- secret/configuration absence fails closed without leaking configuration details.

Only after these checks and the real staging Auth/RLS cases are measured may the staging protocol advance to enrolled Hub/terminal and durable-sync acceptance.

## 11. Stop conditions

Stop immediately if:

- the project ref is production or legacy contaminated staging;
- `git status --porcelain` is non-empty;
- issuer verification fails;
- staging schema verification fails;
- the exact confirmation does not match;
- any command attempts to run the empty-target schema applicator;
- secret values appear in terminal logs/evidence;
- a Function is deployed before required secrets are accepted.

A stop keeps release status **HOLD**. It is not permission to weaken the guard.
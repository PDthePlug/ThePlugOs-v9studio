#!/usr/bin/env bash
# Guarded deployment helper for the cloud authority that issues and revokes
# Hub/terminal admissions. It is intentionally inert unless a human supplies
# either the ADR-009 controlled configuration command or an approved release
# command. It never prints, writes, or accepts browser-visible copies of
# secrets.
set -euo pipefail
set +x

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
cd "$repository_root"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-hub-cloud.sh --verify-source
  scripts/deploy-hub-cloud.sh --configure-production-functions
  scripts/deploy-hub-cloud.sh --deploy

--verify-source performs local release-source checks only.
--configure-production-functions is a production-only, HOLD-preserving ADR-009
configuration window. It requires an exact project, source, migration-ledger,
and issuer-key acknowledgement, sets only Function secrets, and deploys no SQL.
--deploy is fail-closed and requires an APPROVED release status, an explicit
deployment environment/project reference/commit confirmation, the Supabase
CLI, and secure environment variables. It does not create a staging clone or
bypass release evidence.
USAGE
}

require_release_source() {
  node scripts/test-r014-device-pairing-local-links-contract.mjs
  node scripts/test-r015-owner-native-credential-reset-contract.mjs
  node --experimental-strip-types scripts/test-r016-cloud-configuration-contract.mjs
  node scripts/test-r017-terminal-staff-session-contract.mjs
  node scripts/test-r018-terminal-workspace-contract.mjs
  node scripts/test-r019-cloud-delivery-contract.mjs
  node scripts/test-r020-owner-signup-contract.mjs
  node scripts/test-r021-legacy-browser-retirement-contract.mjs
  node scripts/verify-production-migration-ledger.mjs --emit-fingerprint >/dev/null
}

require_approved_release() {
  if ! rg -q '^\- \*\*Status:\*\* APPROVED(?:\b|[[:space:][:punct:]])' docs/operations/RELEASE_STATUS.md; then
    echo "Release status is not APPROVED; refusing remote mutation." >&2
    exit 78
  fi
}

require_hold_release() {
  if ! rg -q '^\- \*\*Status:\*\* HOLD(?:\b|[[:space:][:punct:]])' docs/operations/RELEASE_STATUS.md; then
    echo "Release status is no longer HOLD; use the approved --deploy path instead." >&2
    exit 78
  fi
}

deployment_mode=""
case "${1:-}" in
  --verify-source)
    require_release_source
    echo "Hub cloud source checks passed. No Supabase project was contacted."
    exit 0
    ;;
  --configure-production-functions)
    deployment_mode="controlled-production-function-configuration"
    ;;
  --deploy)
    deployment_mode="approved-release"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac

require_release_source
if [[ "${deployment_mode}" == "approved-release" ]]; then
  require_approved_release
else
  require_hold_release
fi

required=(
  THEPLUGOS_DEPLOYMENT_ENV
  SUPABASE_PROJECT_REF
  THEPLUGOS_EXPECTED_PROJECT_REF
  THEPLUGOS_RELEASE_COMMIT
  SUPABASE_ACCESS_TOKEN
  HUB_AUTHORIZATION_ISSUER_KEY_ID
  HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON
  HUB_AUTHORIZATION_ISSUER_PUBLIC_KEY_BASE64
  HUB_RATE_LIMIT_PEPPER
  HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES
  HUB_OWNER_PORTAL_ORIGIN
)

if [[ "${deployment_mode}" == "approved-release" ]]; then
  required+=(THEPLUGOS_DEPLOY_CONFIRM)
else
  required+=(THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM)
fi

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required secure environment variable: ${name}" >&2
    exit 64
  fi
done

if [[ "${THEPLUGOS_DEPLOYMENT_ENV}" != "staging" && "${THEPLUGOS_DEPLOYMENT_ENV}" != "production" ]]; then
  echo "THEPLUGOS_DEPLOYMENT_ENV must be staging or production." >&2
  exit 64
fi

if [[ "${deployment_mode}" == "controlled-production-function-configuration" && "${THEPLUGOS_DEPLOYMENT_ENV}" != "production" ]]; then
  echo "--configure-production-functions is production-only." >&2
  exit 64
fi

if [[ ! "${SUPABASE_PROJECT_REF}" =~ ^[a-z0-9]{20}$ ]] || [[ "${SUPABASE_PROJECT_REF}" != "${THEPLUGOS_EXPECTED_PROJECT_REF}" ]]; then
  echo "The supplied Supabase project reference is invalid or does not match THEPLUGOS_EXPECTED_PROJECT_REF." >&2
  exit 64
fi

if [[ "${deployment_mode}" == "controlled-production-function-configuration" && "${SUPABASE_PROJECT_REF}" != "iwbbwcaylpulcpvbfkdx" ]]; then
  echo "--configure-production-functions must target the recorded production project." >&2
  exit 64
fi

if [[ ! "${HUB_OWNER_PORTAL_ORIGIN}" =~ ^https://[^/]+$ ]]; then
  echo "HUB_OWNER_PORTAL_ORIGIN must be one HTTPS origin with no path or trailing slash." >&2
  exit 64
fi

if [[ ! "${HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES}" =~ ^[0-9]+$ ]]; then
  echo "HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES must be an integer from 15 through 720." >&2
  exit 64
fi
bundle_ttl_minutes=$((10#${HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES}))
if (( bundle_ttl_minutes < 15 || bundle_ttl_minutes > 720 )); then
  echo "HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES must be an integer from 15 through 720." >&2
  exit 64
fi

checked_commit="$(git rev-parse HEAD)"
if [[ "${THEPLUGOS_RELEASE_COMMIT}" != "${checked_commit}" ]]; then
  echo "THEPLUGOS_RELEASE_COMMIT does not match the checked-out source commit." >&2
  exit 64
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The source tree is not clean; refusing to deploy files that are not the reviewed commit." >&2
  exit 64
fi

issuer_key_fingerprint="$(node scripts/verify-issuer-key-configuration.mjs --emit-fingerprint)"

if [[ "${THEPLUGOS_DEPLOYMENT_ENV}" == "production" ]]; then
  if [[ -z "${THEPLUGOS_PRODUCTION_MIGRATION_LEDGER_SHA256:-}" || -z "${THEPLUGOS_REMOTE_MIGRATION_LEDGER_CONFIRM:-}" ]]; then
    echo "Production Function deployment requires a verified production migration ledger acknowledgement." >&2
    exit 64
  fi
  ledger_fingerprint="$(node scripts/verify-production-migration-ledger.mjs --project-ref "$SUPABASE_PROJECT_REF" --emit-fingerprint)"
  if [[ "${THEPLUGOS_PRODUCTION_MIGRATION_LEDGER_SHA256}" != "${ledger_fingerprint}" ]]; then
    echo "THEPLUGOS_PRODUCTION_MIGRATION_LEDGER_SHA256 does not match the verified source ledger." >&2
    exit 64
  fi
  expected_ledger_confirmation="verified:production:${SUPABASE_PROJECT_REF}:${ledger_fingerprint}"
  if [[ "${THEPLUGOS_REMOTE_MIGRATION_LEDGER_CONFIRM}" != "${expected_ledger_confirmation}" ]]; then
    echo "THEPLUGOS_REMOTE_MIGRATION_LEDGER_CONFIRM must acknowledge the just-verified remote migration ledger." >&2
    exit 64
  fi
fi

if [[ "${deployment_mode}" == "approved-release" ]]; then
  expected_confirmation="deploy:${THEPLUGOS_DEPLOYMENT_ENV}:${SUPABASE_PROJECT_REF}:${checked_commit}"
  if [[ "${THEPLUGOS_DEPLOY_CONFIRM}" != "${expected_confirmation}" ]]; then
    echo "THEPLUGOS_DEPLOY_CONFIRM must exactly acknowledge the environment, project, and commit." >&2
    exit 64
  fi
else
  expected_configuration_confirmation="configure-functions:production:${SUPABASE_PROJECT_REF}:${checked_commit}:${ledger_fingerprint}:${issuer_key_fingerprint}"
  if [[ "${THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM}" != "${expected_configuration_confirmation}" ]]; then
    echo "THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM must exactly acknowledge the production project, source, migration ledger, and issuer public key." >&2
    exit 64
  fi
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required in the secure deployment environment." >&2
  exit 69
fi

# Use the CLI's encrypted project-secret store. The CLI automatically supplies
# SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to Functions;
# these values are intentionally not accepted by this script or source tree.
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  "HUB_AUTHORIZATION_ISSUER_KEY_ID=$HUB_AUTHORIZATION_ISSUER_KEY_ID" \
  "HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON=$HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON" \
  "HUB_RATE_LIMIT_PEPPER=$HUB_RATE_LIMIT_PEPPER" \
  "HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=$HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES" \
  "HUB_OWNER_PORTAL_ORIGIN=$HUB_OWNER_PORTAL_ORIGIN"

# The recorded production baseline uses Supabase-managed remote versions that
# intentionally differ from the immutable source filenames. Never replay it
# with `db push`; ADR-008's exact ledger acknowledgement guards Functions.
# A clean staging target has no such existing history and may receive the
# ordered source migrations only after its separate rehearsal evidence gate.
if [[ "${THEPLUGOS_DEPLOYMENT_ENV}" == "staging" ]]; then
  supabase db push --project-ref "$SUPABASE_PROJECT_REF"
fi

function_names=(hub-enrollment hub-owner-enrollment hub-terminal-enrollment hub-staff-session hub-staff-credential-reset hub-sync)

# R014 is source-complete but is intentionally absent from the recorded
# production R001A–R013 ledger. A staging --deploy applies the ordered schema
# first and may exercise the seventh receiver; the HOLD-preserving production
# configuration window must not deploy a Function whose service RPCs are not
# yet present in the live schema.
if [[ "${deployment_mode}" == "approved-release" && "${THEPLUGOS_DEPLOYMENT_ENV}" == "staging" ]]; then
  function_names+=(hub-terminal-staff-session)
fi

for function_name in "${function_names[@]}"; do
  supabase functions deploy "$function_name" --project-ref "$SUPABASE_PROJECT_REF"
done

if [[ "${deployment_mode}" == "controlled-production-function-configuration" ]]; then
  echo "Hub Functions configured for controlled production verification. No schema migration was executed; product release remains HOLD. Provision Android with the matching public issuer-key map before enrollment."
else
  echo "Hub cloud authority deployed for ${THEPLUGOS_DEPLOYMENT_ENV}. Provision the Android release with the matching public issuer-key map before enrollment."
fi

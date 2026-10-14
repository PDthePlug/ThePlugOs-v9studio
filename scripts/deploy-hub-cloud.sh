#!/usr/bin/env bash
# Guarded deployment helper for ThePlugOS cloud authority.
#
# Remote mutation is split into three explicit paths:
#   * HOLD-preserving isolated staging rehearsal;
#   * HOLD-preserving production Function configuration against the recorded
#     R001A-R013 production schema baseline; and
#   * final production deployment after release status is APPROVED.
#
# The helper never accepts browser-visible copies of server secrets and never
# replays the recorded production schema through Supabase CLI migration history.
set -euo pipefail
set +x

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/.." && pwd)"
cd "$repository_root"

production_project_ref="iwbbwcaylpulcpvbfkdx"
contaminated_legacy_staging_ref="dpqtgfxovmiwzkiuzoya"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-hub-cloud.sh --verify-source
  scripts/deploy-hub-cloud.sh --rehearse-staging
  scripts/deploy-hub-cloud.sh --configure-production-functions
  scripts/deploy-hub-cloud.sh --deploy

--verify-source performs local release-source checks only.

--rehearse-staging is a HOLD-preserving, staging-only evidence path. It refuses
production and the preserved contaminated legacy staging project, requires an
exact project/source/issuer acknowledgement, applies the canonical schema in
explicit source order 001 -> 001A -> 002 ... 016 through the guarded Node
applicator, sets staging Function secrets, and deploys all seven receivers.
It does not change RELEASE_STATUS.md and cannot grant production release.

--configure-production-functions is the ADR-009 HOLD-preserving production
configuration window. It requires the exact recorded production project,
source, R001A-R013 migration ledger and issuer acknowledgement, sets Function
secrets, deploys only receivers supported by that recorded schema, and executes
no SQL.

--deploy is the final production-only path. It requires RELEASE_STATUS.md to be
APPROVED plus exact environment/project/source confirmations. It never uses
`db push` against the recorded production database.
USAGE
}

require_release_source() {
  node scripts/test-r014-device-pairing-local-links-contract.mjs
  node scripts/test-r015-owner-native-credential-reset-contract.mjs
  node --experimental-strip-types scripts/test-r016-cloud-configuration-contract.mjs
  node scripts/test-r017-terminal-staff-session-contract.mjs
  node scripts/test-r018-terminal-workspace-contract.mjs
  node --experimental-strip-types scripts/test-r019-cloud-delivery-contract.mjs
  node scripts/test-r020-owner-signup-contract.mjs
  node scripts/test-r021-legacy-browser-retirement-contract.mjs
  node scripts/test-r029-owner-control-plane-rls-contract.mjs
  node scripts/test-r030-staging-backend-rehearsal-contract.mjs
  node scripts/test-r031-staging-secret-material-contract.mjs
  node scripts/test-r032-terminal-session-index-hardening-contract.mjs
  node scripts/verify-production-migration-ledger.mjs --emit-fingerprint >/dev/null
}

require_approved_release() {
  if ! rg -q '^\- \*\*Status:\*\* APPROVED(?:\b|[[:space:][:punct:]])' docs/operations/RELEASE_STATUS.md; then
    echo "Release status is not APPROVED; refusing final production deployment." >&2
    exit 78
  fi
}

require_hold_release() {
  if ! rg -q '^\- \*\*Status:\*\* HOLD(?:\b|[[:space:][:punct:]])' docs/operations/RELEASE_STATUS.md; then
    echo "Release status is no longer HOLD; use the approved production path." >&2
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
  --rehearse-staging)
    deployment_mode="hold-staging-rehearsal"
    ;;
  --configure-production-functions)
    deployment_mode="controlled-production-function-configuration"
    ;;
  --deploy)
    deployment_mode="approved-production-release"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac

require_release_source
if [[ "${deployment_mode}" == "approved-production-release" ]]; then
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

case "${deployment_mode}" in
  hold-staging-rehearsal)
    required+=(
      THEPLUGOS_STAGING_DATABASE_URL
      THEPLUGOS_STAGING_SCHEMA_CONFIRM
      THEPLUGOS_STAGING_REHEARSAL_CONFIRM
    )
    ;;
  controlled-production-function-configuration)
    required+=(THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM)
    ;;
  approved-production-release)
    required+=(THEPLUGOS_DEPLOY_CONFIRM)
    ;;
esac

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

if [[ "${deployment_mode}" == "hold-staging-rehearsal" && "${THEPLUGOS_DEPLOYMENT_ENV}" != "staging" ]]; then
  echo "--rehearse-staging requires THEPLUGOS_DEPLOYMENT_ENV=staging." >&2
  exit 64
fi
if [[ "${deployment_mode}" != "hold-staging-rehearsal" && "${THEPLUGOS_DEPLOYMENT_ENV}" != "production" ]]; then
  echo "Production configuration/release modes require THEPLUGOS_DEPLOYMENT_ENV=production." >&2
  exit 64
fi

if [[ ! "${SUPABASE_PROJECT_REF}" =~ ^[a-z0-9]{20}$ ]] || [[ "${SUPABASE_PROJECT_REF}" != "${THEPLUGOS_EXPECTED_PROJECT_REF}" ]]; then
  echo "The supplied Supabase project reference is invalid or does not match THEPLUGOS_EXPECTED_PROJECT_REF." >&2
  exit 64
fi

if [[ "${deployment_mode}" == "hold-staging-rehearsal" ]]; then
  if [[ "${SUPABASE_PROJECT_REF}" == "${production_project_ref}" ]]; then
    echo "The staging rehearsal refuses the production project." >&2
    exit 78
  fi
  if [[ "${SUPABASE_PROJECT_REF}" == "${contaminated_legacy_staging_ref}" ]]; then
    echo "The staging rehearsal refuses the preserved contaminated legacy staging project." >&2
    exit 78
  fi
else
  if [[ "${SUPABASE_PROJECT_REF}" != "${production_project_ref}" ]]; then
    echo "Production modes must target the recorded ThePlugOS production project." >&2
    exit 64
  fi
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
ledger_fingerprint=""
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

case "${deployment_mode}" in
  hold-staging-rehearsal)
    expected_rehearsal_confirmation="rehearse-staging:${SUPABASE_PROJECT_REF}:${checked_commit}:${issuer_key_fingerprint}"
    if [[ "${THEPLUGOS_STAGING_REHEARSAL_CONFIRM}" != "${expected_rehearsal_confirmation}" ]]; then
      echo "THEPLUGOS_STAGING_REHEARSAL_CONFIRM must exactly acknowledge the staging project, source commit, and issuer public key." >&2
      exit 64
    fi
    ;;
  controlled-production-function-configuration)
    expected_configuration_confirmation="configure-functions:production:${SUPABASE_PROJECT_REF}:${checked_commit}:${ledger_fingerprint}:${issuer_key_fingerprint}"
    if [[ "${THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM}" != "${expected_configuration_confirmation}" ]]; then
      echo "THEPLUGOS_FUNCTION_CONFIGURATION_CONFIRM must exactly acknowledge the production project, source, migration ledger, and issuer public key." >&2
      exit 64
    fi
    ;;
  approved-production-release)
    expected_confirmation="deploy:production:${SUPABASE_PROJECT_REF}:${checked_commit}"
    if [[ "${THEPLUGOS_DEPLOY_CONFIRM}" != "${expected_confirmation}" ]]; then
      echo "THEPLUGOS_DEPLOY_CONFIRM must exactly acknowledge the production project and source commit." >&2
      exit 64
    fi
    ;;
esac

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required in the secure deployment environment." >&2
  exit 69
fi

# Schema comes first in isolated staging so no receiver is published before the
# exact RPCs, policies and supporting indexes it depends on exist. The
# applicator refuses non-empty targets and applies the non-CLI-named R001A
# migration explicitly in order.
if [[ "${deployment_mode}" == "hold-staging-rehearsal" ]]; then
  node scripts/apply-staging-schema.mjs --apply --project-ref "$SUPABASE_PROJECT_REF"
fi

# Hosted Edge Functions receive SUPABASE_URL plus modern publishable/secret key
# maps automatically (with legacy key fallbacks on older projects). Only
# ThePlugOS-owned secrets are set here; platform API keys are never copied into
# this script or source tree.
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  "HUB_AUTHORIZATION_ISSUER_KEY_ID=$HUB_AUTHORIZATION_ISSUER_KEY_ID" \
  "HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON=$HUB_AUTHORIZATION_ISSUER_PRIVATE_JWK_JSON" \
  "HUB_RATE_LIMIT_PEPPER=$HUB_RATE_LIMIT_PEPPER" \
  "HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES=$HUB_AUTHORIZATION_BUNDLE_TTL_MINUTES" \
  "HUB_OWNER_PORTAL_ORIGIN=$HUB_OWNER_PORTAL_ORIGIN"

# Production remains bound to the recorded R001A-R013 ledger. Until an accepted
# production schema-advance record contains R014-R016, do not publish the
# terminal staff-session receiver there. Isolated staging receives all seven.
function_names=(
  hub-enrollment
  hub-owner-enrollment
  hub-terminal-enrollment
  hub-staff-session
  hub-staff-credential-reset
  hub-sync
)
if [[ "${deployment_mode}" == "hold-staging-rehearsal" ]]; then
  function_names+=(hub-terminal-staff-session)
fi

for function_name in "${function_names[@]}"; do
  supabase functions deploy "$function_name" --project-ref "$SUPABASE_PROJECT_REF"
done

case "${deployment_mode}" in
  hold-staging-rehearsal)
    echo "Isolated staging schema 001-016 and all seven Hub receivers deployed for evidence rehearsal. Product release remains HOLD. Provision Android only with the matching public issuer-key map before hardware acceptance."
    ;;
  controlled-production-function-configuration)
    echo "Hub Functions configured for controlled production verification against the recorded R001A-R013 baseline. No schema migration was executed; product release remains HOLD."
    ;;
  approved-production-release)
    echo "Recorded-baseline Hub cloud receivers deployed to production after release approval. Any receiver requiring schema beyond the accepted production ledger remains withheld."
    ;;
esac

-- R003 local-first Hub authority preflight
--
-- Run this only against the accepted R001 clone *after* the accepted R002
-- rehearsal. It intentionally makes no schema or data change. A failed check
-- is a stop condition, not an invitation to repair staging by hand.

BEGIN READ ONLY;

WITH checks(name, passed, detail) AS (
    VALUES
        (
            'r002_tables_present',
            to_regclass('public.staff_credentials') IS NOT NULL
                AND to_regclass('public.staff_security_sessions') IS NOT NULL
                AND to_regclass('public.device_pairing_attempts') IS NOT NULL
                AND to_regclass('public.device_pairing_codes') IS NOT NULL,
            'R003 requires the complete accepted R002 table set.'
        ),
        (
            'r002_functions_present',
            to_regprocedure('private.r002_crypt(text,text)') IS NOT NULL
                AND to_regprocedure('private.r002_random_bytes(integer)') IS NOT NULL
                AND to_regprocedure('public.verify_staff_pin(uuid,uuid,uuid,text)') IS NOT NULL,
            'R003 must use the accepted R002 credential primitives rather than replacement helpers.'
        ),
        (
            'pairing_code_plaintext_removed',
            NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'device_pairing_codes'
                  AND column_name = 'pairing_code'
            )
            AND EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'device_pairing_codes'
                  AND column_name = 'pairing_code_hash'
            ),
            'R002 pairing-code isolation has not been established.'
        ),
        (
            'legacy_pin_hashes_cleared',
            NOT EXISTS (
                SELECT 1 FROM public.staff_members WHERE pin_hash IS NOT NULL
            ),
            'Legacy staff_members.pin_hash values remain; resolve the R002 credential migration first.'
        ),
        (
            'pgcrypto_available',
            EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'),
            'R003 needs the pgcrypto extension that R002 already validates.'
        ),
        (
            'no_partial_r003_state',
            to_regclass('public.hub_branch_authority') IS NULL
                AND to_regclass('public.hub_authorization_bundles') IS NULL
                AND to_regclass('public.hub_events') IS NULL
                AND to_regclass('public.inventory_branch_balances') IS NULL
                AND to_regclass('public.inventory_movements') IS NULL
                AND to_regprocedure('public.r003_begin_hub_enrollment(text,uuid,text,text,text,text,text,text,text,text)') IS NULL
                AND to_regprocedure('public.r003_issue_hub_pairing_code(uuid,uuid,uuid,text,text)') IS NULL,
            'R003 artifacts already exist. Restore the clean accepted R002 staging checkpoint before retrying.'
        )
)
SELECT name, passed, detail
FROM checks
ORDER BY name;

COMMIT;

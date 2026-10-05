import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const r001Sql = await readFile(
  join(REPO_ROOT, 'supabase/migrations/001_mvp_core.sql'),
  'utf8',
);
const r002Sql = await readFile(
  join(REPO_ROOT, 'supabase/migrations/002_secure_identity_devices.sql'),
  'utf8',
);
const preflightSql = await readFile(
  join(REPO_ROOT, 'supabase/preflight/002_secure_identity_devices_preflight.sql'),
  'utf8',
);

const IDS = Object.freeze({
  ownerUserA: '00000000-0000-4000-8000-000000000001',
  ownerUserB: '00000000-0000-4000-8000-000000000002',
  businessA: '10000000-0000-4000-8000-000000000001',
  branchA1: '11000000-0000-4000-8000-000000000001',
  branchA2: '11000000-0000-4000-8000-000000000002',
  businessB: '20000000-0000-4000-8000-000000000001',
  branchB1: '21000000-0000-4000-8000-000000000001',
  ownerA: 'a0000000-0000-4000-8000-000000000001',
  managerA1: 'a0000000-0000-4000-8000-000000000002',
  cashierA1: 'a0000000-0000-4000-8000-000000000003',
  cashierA2: 'a0000000-0000-4000-8000-000000000004',
  ownerB: 'b0000000-0000-4000-8000-000000000001',
  productA1: 'c0000000-0000-4000-8000-000000000001',
});

let passed = 0;

async function test(name, operation) {
  try {
    await operation();
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, '0')} ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function createDatabase(dataDir) {
  const options = { extensions: { pgcrypto } };
  const db = dataDir
    ? new PGlite(dataDir, options)
    : new PGlite(options);
  await db.waitReady;
  return db;
}

async function installSupabaseFixture(db) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
  `);

  await db.exec(r001Sql);

  // Install pgcrypto outside public to prove R002 does not depend on an
  // extension search path used by one particular Supabase project.
  await db.exec(`
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;
  `);
}

async function seedR001(db, { unsupportedCredential = false } = {}) {
  const cashierHashExpression = unsupportedCredential
    ? `repeat('a', 64)`
    : `extensions.crypt('1111', extensions.gen_salt('bf', 8))`;

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${IDS.ownerUserA}', 'owner-a@example.test'),
      ('${IDS.ownerUserB}', 'owner-b@example.test');

    INSERT INTO public.businesses (id, name, owner_id, onboarding_status) VALUES
      ('${IDS.businessA}', 'Business A', '${IDS.ownerUserA}', 'COMPLETED'),
      ('${IDS.businessB}', 'Business B', '${IDS.ownerUserB}', 'COMPLETED');

    INSERT INTO public.business_memberships (business_id, user_id, role) VALUES
      ('${IDS.businessA}', '${IDS.ownerUserA}', 'OWNER'),
      ('${IDS.businessB}', '${IDS.ownerUserB}', 'OWNER');

    INSERT INTO public.branches (id, business_id, name) VALUES
      ('${IDS.branchA1}', '${IDS.businessA}', 'A Main'),
      ('${IDS.branchA2}', '${IDS.businessA}', 'A Second'),
      ('${IDS.branchB1}', '${IDS.businessB}', 'B Main');

    INSERT INTO public.staff_members (
      id, business_id, branch_id, name, role, status, pin_hash
    ) VALUES
      ('${IDS.ownerA}', '${IDS.businessA}', '${IDS.branchA1}', 'Owner A', 'OWNER', 'ACTIVE',
       extensions.crypt('2468', extensions.gen_salt('bf', 8))),
      ('${IDS.managerA1}', '${IDS.businessA}', '${IDS.branchA1}', 'Manager A1', 'MANAGER', 'ACTIVE',
       extensions.crypt('1357', extensions.gen_salt('bf', 8))),
      ('${IDS.cashierA1}', '${IDS.businessA}', '${IDS.branchA1}', 'Cashier A1', 'CASHIER', 'ACTIVE',
       ${cashierHashExpression}),
      ('${IDS.cashierA2}', '${IDS.businessA}', '${IDS.branchA2}', 'Cashier A2', 'CASHIER', 'ACTIVE',
       extensions.crypt('2222', extensions.gen_salt('bf', 8))),
      ('${IDS.ownerB}', '${IDS.businessB}', '${IDS.branchB1}', 'Owner B', 'OWNER', 'ACTIVE',
       extensions.crypt('9999', extensions.gen_salt('bf', 8)));

    INSERT INTO public.catalog_products (
      id, business_id, branch_id, name, category, price, stock_quantity, unit_of_measure
    ) VALUES (
      '${IDS.productA1}', '${IDS.businessA}', '${IDS.branchA1}',
      'Audit Coffee', 'Drinks', 25.00, 50, 'each'
    );

    INSERT INTO public.device_pairing_codes (
      pairing_code, business_id, branch_id, created_by, status, expires_at
    ) VALUES (
      '654321', '${IDS.businessA}', '${IDS.branchA1}', '${IDS.ownerUserA}',
      'WAITING', NOW() + INTERVAL '1 hour'
    );

    INSERT INTO public.devices (
      device_id, business_id, branch_id, name, type, status, last_seen
    ) VALUES (
      'DEVICE-B1-0001', '${IDS.businessB}', '${IDS.branchB1}',
      'Business B Terminal', 'TERMINAL', 'ACTIVE', NOW()
    );
  `);
}

async function setAuth(db, userId = null, role = null) {
  await db.query(
    `SELECT
       set_config('request.jwt.claim.sub', $1::TEXT, false),
       set_config('request.jwt.claim.role', $2::TEXT, false)`,
    [userId ?? '', role ?? ''],
  );
}

async function rpc(db, signature, values) {
  const result = await db.query(`SELECT ${signature} AS result`, values);
  return result.rows[0].result;
}

async function setStaffPin(db, {
  staffId,
  businessId = IDS.businessA,
  branchId,
  pin,
  sessionToken = null,
}) {
  return rpc(
    db,
    'public.set_staff_pin($1::UUID, $2::UUID, $3::UUID, $4::TEXT, $5::TEXT)',
    [staffId, businessId, branchId, pin, sessionToken],
  );
}

async function verifyStaffPin(db, {
  staffId,
  businessId = IDS.businessA,
  branchId,
  pin,
}) {
  return rpc(
    db,
    'public.verify_staff_pin($1::UUID, $2::UUID, $3::UUID, $4::TEXT)',
    [staffId, businessId, branchId, pin],
  );
}

async function expectTableReadDenied(db, role, table) {
  await db.exec(`SET ROLE ${role}`);
  let denied = false;
  try {
    await db.query(`SELECT * FROM ${table} LIMIT 1`);
  } catch (error) {
    denied = /permission denied/i.test(error.message);
  } finally {
    await db.exec('RESET ROLE');
  }
  assert.equal(denied, true, `${role} unexpectedly read ${table}`);
}

async function runUnsupportedCredentialGate() {
  const db = await createDatabase();
  try {
    await installSupabaseFixture(db);
    await seedR001(db, { unsupportedCredential: true });

    let migrationError;
    try {
      await db.exec(r002Sql);
    } catch (error) {
      migrationError = error;
    }

    await test('unknown legacy credential blocks R002 with a named failure', async () => {
      assert.ok(migrationError, 'R002 unexpectedly accepted an unknown credential');
      assert.match(migrationError.message, /R002_UNSUPPORTED_LEGACY_CREDENTIALS/);
    });

    await test('failed credential preflight leaves R001 data and schema unchanged', async () => {
      const credential = await db.query(
        'SELECT pin_hash FROM public.staff_members WHERE id = $1::UUID',
        [IDS.cashierA1],
      );
      assert.equal(credential.rows[0].pin_hash, 'a'.repeat(64));
      const table = await db.query(
        `SELECT to_regclass('public.staff_credentials')::TEXT AS name`,
      );
      assert.equal(table.rows[0].name, null);
      const rawCode = await db.query(
        `SELECT pairing_code FROM public.device_pairing_codes LIMIT 1`,
      );
      assert.equal(rawCode.rows[0].pairing_code, '654321');
    });
  } finally {
    await db.close();
  }
}

async function runHappyPathGate() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'theplugos-r002-'));
  const dataDir = join(tempRoot, 'pgdata');
  let db = await createDatabase(dataDir);

  try {
    await installSupabaseFixture(db);
    await seedR001(db);
    await db.exec(r002Sql);

    await test('R001 applies before R002 and pgcrypto is discovered outside public', async () => {
      const result = await db.query(`
        SELECT n.nspname AS extension_schema,
               to_regprocedure('private.r002_crypt(text,text)') IS NOT NULL AS wrapper_exists
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgcrypto'
      `);
      assert.equal(result.rows[0].extension_schema, 'extensions');
      assert.equal(result.rows[0].wrapper_exists, true);
    });

    await test('valid bcrypt credentials move to the isolated credential table', async () => {
      const moved = await db.query(`
        SELECT
          count(*)::INTEGER AS credential_count,
          count(*) FILTER (WHERE sm.pin_hash IS NOT NULL)::INTEGER AS legacy_nonnull,
          bool_and(sc.business_id = sm.business_id) AS business_binding
        FROM public.staff_members sm
        JOIN public.staff_credentials sc ON sc.staff_id = sm.id
      `);
      assert.equal(moved.rows[0].credential_count, 5);
      assert.equal(moved.rows[0].legacy_nonnull, 0);
      assert.equal(moved.rows[0].business_binding, true);
    });

    await test('legacy pairing codes are revoked and raw codes are removed', async () => {
      const result = await db.query(`
        SELECT status,
               pairing_code_hash ~ '^\\$2[ab]\\$' AS valid_bcrypt,
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'device_pairing_codes'
                   AND column_name = 'pairing_code'
               ) AS raw_column_exists
        FROM public.device_pairing_codes
        LIMIT 1
      `);
      assert.equal(result.rows[0].status, 'REVOKED');
      assert.equal(result.rows[0].valid_bcrypt, true);
      assert.equal(result.rows[0].raw_column_exists, false);
    });

    await test('browser roles cannot read credential, session, pairing hash, or throttle tables', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const table of [
          'public.staff_credentials',
          'public.staff_security_sessions',
          'public.device_pairing_codes',
          'public.device_pairing_attempts',
        ]) {
          await expectTableReadDenied(db, role, table);
        }
      }
    });

    await setAuth(db, IDS.ownerUserA, 'authenticated');
    await test('authenticated business owner can set an onboarding PIN', async () => {
      await db.exec('SET ROLE authenticated');
      try {
        const result = await setStaffPin(db, {
          staffId: IDS.cashierA2,
          branchId: IDS.branchA2,
          pin: '4242',
        });
        assert.deepEqual(result, { success: true });
      } finally {
        await db.exec('RESET ROLE');
      }
    });

    await test('explicit service-role grant reaches the documented administration path', async () => {
      await setAuth(db, null, 'service_role');
      await db.exec('SET ROLE service_role');
      try {
        const result = await setStaffPin(db, {
          staffId: IDS.ownerB,
          businessId: IDS.businessB,
          branchId: IDS.branchB1,
          pin: '9898',
        });
        assert.equal(result.success, true);
      } finally {
        await db.exec('RESET ROLE');
      }
      await setAuth(db, IDS.ownerUserA, 'authenticated');
    });

    await test('PIN verification is server-side and rejects malformed input generically', async () => {
      const valid = await verifyStaffPin(db, {
        staffId: IDS.cashierA2,
        branchId: IDS.branchA2,
        pin: '4242',
      });
      assert.equal(valid.authenticated, true);
      assert.equal('pin' in valid.staff, false);
      assert.equal('pin_hash' in valid.staff, false);

      const malformed = await verifyStaffPin(db, {
        staffId: IDS.cashierA2,
        branchId: IDS.branchA2,
        pin: 'not-a-pin',
      });
      assert.deepEqual(malformed, {
        authenticated: false,
        error: 'Invalid security PIN.',
      });
    });

    await test('five wrong PINs persist a five-minute lockout', async () => {
      let fifth;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        fifth = await verifyStaffPin(db, {
          staffId: IDS.cashierA1,
          branchId: IDS.branchA1,
          pin: '0000',
        });
      }
      assert.equal(fifth.authenticated, false);
      assert.equal(fifth.locked, true);

      const state = await db.query(`
        SELECT failed_attempts, locked_until > NOW() AS locked
        FROM public.staff_credentials
        WHERE staff_id = $1::UUID
      `, [IDS.cashierA1]);
      assert.equal(state.rows[0].failed_attempts, 5);
      assert.equal(state.rows[0].locked, true);
    });

    await db.close();
    db = await createDatabase(dataDir);

    await test('PIN lockout survives database close and reopen', async () => {
      const blocked = await verifyStaffPin(db, {
        staffId: IDS.cashierA1,
        branchId: IDS.branchA1,
        pin: '1111',
      });
      assert.equal(blocked.authenticated, false);
      assert.equal(blocked.locked, true);
    });

    const managerLogin = await verifyStaffPin(db, {
      staffId: IDS.managerA1,
      branchId: IDS.branchA1,
      pin: '1357',
    });

    await test('verified manager login issues only a hashed delegated session', async () => {
      assert.equal(managerLogin.authenticated, true);
      assert.match(managerLogin.sessionToken, /^[a-f0-9]{64}$/);
      const stored = await db.query(`
        SELECT session_token_hash,
               session_token_hash = $1::TEXT AS stored_raw,
               expires_at > NOW() AS active
        FROM public.staff_security_sessions
        WHERE staff_id = $2::UUID AND revoked_at IS NULL
      `, [managerLogin.sessionToken, IDS.managerA1]);
      assert.equal(stored.rows[0].stored_raw, false);
      assert.equal(stored.rows[0].active, true);
      assert.match(stored.rows[0].session_token_hash, /^\$2[ab]\$/);
    });

    await test('manager cannot change owner credentials', async () => {
      const result = await setStaffPin(db, {
        staffId: IDS.ownerA,
        branchId: IDS.branchA1,
        pin: '8080',
        sessionToken: managerLogin.sessionToken,
      });
      assert.equal(result.success, false);
      assert.match(result.error, /cannot modify Owner/i);
    });

    await test('manager authority is restricted to its own branch', async () => {
      const crossBranch = await setStaffPin(db, {
        staffId: IDS.cashierA2,
        branchId: IDS.branchA2,
        pin: '8080',
        sessionToken: managerLogin.sessionToken,
      });
      assert.equal(crossBranch.success, false);
      assert.match(crossBranch.error, /authorized branch/i);

      const sameBranch = await setStaffPin(db, {
        staffId: IDS.cashierA1,
        branchId: IDS.branchA1,
        pin: '8080',
        sessionToken: managerLogin.sessionToken,
      });
      assert.equal(sameBranch.success, true);
    });

    await test('delegated session revocation invalidates that bearer token', async () => {
      const revoked = await rpc(
        db,
        'public.revoke_staff_security_session($1::TEXT)',
        [managerLogin.sessionToken],
      );
      assert.equal(revoked.success, true);

      const rejected = await setStaffPin(db, {
        staffId: IDS.cashierA1,
        branchId: IDS.branchA1,
        pin: '8181',
        sessionToken: managerLogin.sessionToken,
      });
      assert.equal(rejected.success, false);
      assert.match(rejected.error, /Invalid or expired session token/i);
    });

    const freshManagerLogin = await verifyStaffPin(db, {
      staffId: IDS.managerA1,
      branchId: IDS.branchA1,
      pin: '1357',
    });

    await test('active six-digit pairing codes cannot collide across tenants', async () => {
      await db.exec(`
        INSERT INTO public.device_pairing_codes (
          pairing_code_hash, business_id, branch_id, status, expires_at
        ) VALUES (
          private.r002_crypt('100000', private.r002_gen_salt('bf', 8)),
          '${IDS.businessB}', '${IDS.branchB1}', 'WAITING', NOW() + INTERVAL '10 minutes'
        );

        CREATE OR REPLACE FUNCTION private.r002_random_bytes(p_count INTEGER)
        RETURNS BYTEA
        LANGUAGE sql
        VOLATILE STRICT PARALLEL UNSAFE
        SET search_path = pg_catalog
        AS $$ SELECT decode(repeat('00', $1), 'hex') $$;
      `);

      let collisionError;
      try {
        await rpc(
          db,
          'public.create_device_pairing_code($1::UUID, $2::UUID, $3::TEXT)',
          [IDS.businessA, IDS.branchA1, freshManagerLogin.sessionToken],
        );
      } catch (error) {
        collisionError = error;
      } finally {
        await db.exec(`
          CREATE OR REPLACE FUNCTION private.r002_random_bytes(p_count INTEGER)
          RETURNS BYTEA
          LANGUAGE sql
          VOLATILE STRICT PARALLEL UNSAFE
          SET search_path = pg_catalog
          AS $$ SELECT extensions.gen_random_bytes($1) $$;
        `);
      }

      assert.ok(collisionError);
      assert.match(collisionError.message, /R002_PAIRING_CODE_SPACE_EXHAUSTED/);
    });

    let pairingCode;
    await test('manager creates a bcrypt-hashed, expiring pairing code', async () => {
      const created = await rpc(
        db,
        'public.create_device_pairing_code($1::UUID, $2::UUID, $3::TEXT)',
        [IDS.businessA, IDS.branchA1, freshManagerLogin.sessionToken],
      );
      assert.equal(created.success, true);
      assert.match(created.pairing_code, /^\d{6}$/);
      pairingCode = created.pairing_code;

      const stored = await db.query(`
        SELECT pairing_code_hash,
               expires_at > NOW() AS active,
               private.r002_crypt($1::TEXT, pairing_code_hash) = pairing_code_hash AS verifies
        FROM public.device_pairing_codes
        WHERE status = 'WAITING'
        ORDER BY created_at DESC
        LIMIT 1
      `, [pairingCode]);
      assert.notEqual(stored.rows[0].pairing_code_hash, pairingCode);
      assert.equal(stored.rows[0].active, true);
      assert.equal(stored.rows[0].verifies, true);
    });

    await test('five wrong pairing attempts persist a per-device lockout', async () => {
      let fifth;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        fifth = await rpc(
          db,
          'public.pair_device_with_code($1::TEXT, $2::TEXT, $3::TEXT, $4::TEXT)',
          ['000000', 'DEVICE-LOCK-001', 'Locked Device', 'TERMINAL'],
        );
      }
      assert.equal(fifth.success, false);
      assert.equal(fifth.locked, true);

      const validButLocked = await rpc(
        db,
        'public.pair_device_with_code($1::TEXT, $2::TEXT, $3::TEXT, $4::TEXT)',
        [pairingCode, 'DEVICE-LOCK-001', 'Locked Device', 'TERMINAL'],
      );
      assert.equal(validButLocked.success, false);
      assert.equal(validButLocked.locked, true);
    });

    await test('pairing code is single-use and creates the exact branch binding', async () => {
      const enrolled = await rpc(
        db,
        'public.pair_device_with_code($1::TEXT, $2::TEXT, $3::TEXT, $4::TEXT)',
        [pairingCode, 'DEVICE-A1-0001', 'A Main POS', 'TERMINAL'],
      );
      assert.equal(enrolled.success, true);
      assert.equal(enrolled.business_id, IDS.businessA);
      assert.equal(enrolled.branch_id, IDS.branchA1);

      const reused = await rpc(
        db,
        'public.pair_device_with_code($1::TEXT, $2::TEXT, $3::TEXT, $4::TEXT)',
        [pairingCode, 'DEVICE-A1-0002', 'Second POS', 'TERMINAL'],
      );
      assert.equal(reused.success, false);

      const stored = await db.query(`
        SELECT business_id, branch_id, status
        FROM public.devices WHERE device_id = 'DEVICE-A1-0001'
      `);
      assert.equal(stored.rows[0].business_id, IDS.businessA);
      assert.equal(stored.rows[0].branch_id, IDS.branchA1);
      assert.equal(stored.rows[0].status, 'ACTIVE');
    });

    await test('active bootstrap is branch-scoped and contains no credential material', async () => {
      const bootstrap = await rpc(
        db,
        'public.get_device_bootstrap($1::TEXT)',
        ['DEVICE-A1-0001'],
      );
      assert.equal(bootstrap.success, true);
      assert.equal(bootstrap.business.id, IDS.businessA);
      assert.equal(bootstrap.branch.id, IDS.branchA1);
      assert.equal(bootstrap.staff.some((staff) => staff.branch_id !== IDS.branchA1), false);
      assert.equal(JSON.stringify(bootstrap).includes('pin_hash'), false);
      assert.equal(JSON.stringify(bootstrap).includes('session_token_hash'), false);
    });

    await test('manager cannot administer another branch or business device', async () => {
      const otherBranch = await rpc(
        db,
        'public.create_device_pairing_code($1::UUID, $2::UUID, $3::TEXT)',
        [IDS.businessA, IDS.branchA2, freshManagerLogin.sessionToken],
      );
      assert.equal(otherBranch.success, false);

      const otherBusiness = await rpc(
        db,
        'public.revoke_device($1::UUID, $2::TEXT, $3::TEXT)',
        [IDS.businessB, 'DEVICE-B1-0001', freshManagerLogin.sessionToken],
      );
      assert.equal(otherBusiness.success, false);
    });

    await test('device revocation immediately blocks status and bootstrap RPCs', async () => {
      const revoked = await rpc(
        db,
        'public.revoke_device($1::UUID, $2::TEXT, $3::TEXT)',
        [IDS.businessA, 'DEVICE-A1-0001', freshManagerLogin.sessionToken],
      );
      assert.equal(revoked.success, true);

      const status = await rpc(
        db,
        'public.verify_device_status($1::TEXT)',
        ['DEVICE-A1-0001'],
      );
      assert.equal(status.active, false);
      assert.equal(status.status, 'REVOKED');

      const bootstrap = await rpc(
        db,
        'public.get_device_bootstrap($1::TEXT)',
        ['DEVICE-A1-0001'],
      );
      assert.equal(bootstrap.success, false);
      assert.equal(bootstrap.status, 'REVOKED');
    });

    await test('security audit event IDs remain unique during a burst', async () => {
      await setAuth(db, IDS.ownerUserA, 'authenticated');
      for (let index = 0; index < 25; index += 1) {
        const result = await setStaffPin(db, {
          staffId: IDS.cashierA2,
          branchId: IDS.branchA2,
          pin: String(5000 + index),
        });
        assert.equal(result.success, true);
      }

      const duplicates = await db.query(`
        SELECT count(*)::INTEGER AS duplicate_groups
        FROM (
          SELECT event_id FROM public.audit_logs
          GROUP BY event_id HAVING count(*) > 1
        ) duplicate_ids
      `);
      assert.equal(duplicates.rows[0].duplicate_groups, 0);
    });

    await test('intended anonymous RPC execution remains available without table reads', async () => {
      await db.exec('SET ROLE anon');
      try {
        const result = await verifyStaffPin(db, {
          staffId: IDS.cashierA2,
          branchId: IDS.branchA2,
          pin: '5024',
        });
        assert.equal(result.authenticated, true);
      } finally {
        await db.exec('RESET ROLE');
      }
    });

    await test('read-only preflight recognizes the completed R002 fixture', async () => {
      await db.exec(preflightSql);
      const unsafe = await db.query(`
        SELECT count(*)::INTEGER AS count
        FROM public.staff_members
        WHERE pin_hash IS NOT NULL AND trim(pin_hash) <> ''
      `);
      assert.equal(unsafe.rows[0].count, 0);
    });
  } finally {
    if (!db.closed) {
      await db.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await runUnsupportedCredentialGate();
await runHappyPathGate();

console.log(`R002 REPOSITORY GATE PASSED: ${passed}/${passed} checks`);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => readFile(resolve(root, path), 'utf8');
const migration = await load('supabase/migrations/016_terminal_staff_session_index_hardening.sql');

assert.match(migration, /R016_REQUIRES_COMPLETE_R014_BASELINE/);
assert.match(migration, /to_regclass\('public\.hub_terminal_staff_session_challenges'\)/);

const requiredIndexes = [
  ['idx_hub_terminal_staff_session_challenges_branch_id', 'branch_id'],
  ['idx_hub_terminal_staff_session_challenges_business_id', 'business_id'],
  ['idx_hub_terminal_staff_session_challenges_hub_device_id', 'hub_device_id'],
  ['idx_hub_terminal_staff_session_challenges_prepared_session_id', 'prepared_session_id'],
  ['idx_hub_terminal_staff_session_challenges_staff_id', 'staff_id'],
];

for (const [name, column] of requiredIndexes) {
  assert.match(
    migration,
    new RegExp(`CREATE INDEX IF NOT EXISTS ${name}\\s+ON public\\.hub_terminal_staff_session_challenges \\(${column}\\);`),
    `${name} must remain a direct covering index for ${column}.`,
  );
}

const createIndexCount = (migration.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length;
assert.equal(createIndexCount, requiredIndexes.length, 'R016 must remain limited to the five live-advisor index gaps.');

for (const forbidden of [
  'CREATE POLICY',
  'DROP POLICY',
  'ALTER TABLE',
  'GRANT ',
  'REVOKE ',
  'CREATE OR REPLACE FUNCTION',
  'CREATE TRIGGER',
  'DROP TRIGGER',
  'INSERT INTO',
  'UPDATE ',
  'DELETE FROM',
]) {
  assert.ok(!migration.includes(forbidden), `R016 must not change authority semantics via ${forbidden.trim()}.`);
}

console.log('R032 terminal staff-session index hardening contract passed');

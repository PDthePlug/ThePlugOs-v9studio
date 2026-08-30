import assert from 'node:assert/strict';

import {
  R002_IDENTIFIERS,
  SchemaDumpInspectionError,
  inspectR001SchemaDump,
} from './inspect-r001-schema-dump.mjs';

let passed = 0;

function test(name, operation) {
  try {
    operation();
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, '0')} ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function accepts(sql) {
  assert.doesNotThrow(() => inspectR001SchemaDump(sql));
}

function rejects(sql, code) {
  assert.throws(
    () => inspectR001SchemaDump(sql),
    (error) => error instanceof SchemaDumpInspectionError && error.code === code,
  );
}

test('allows executable schema DDL and quoted keyword identifiers', () => {
  accepts(`
    CREATE TABLE public."update" ("drop" TEXT NOT NULL);
    ALTER TABLE public."update" ENABLE ROW LEVEL SECURITY;
    CREATE INDEX example_idx ON public."update" ("drop");
  `);
});

test('ignores SQL-like content in comments and string literals', () => {
  accepts(`
    -- DROP TABLE public.staff_credentials;
    /* INSERT INTO public.staff_security_sessions VALUES ('not executable'); */
    COMMENT ON TABLE public.safe_table IS 'DELETE FROM public.device_pairing_attempts';
    CREATE TABLE public.safe_table (id UUID PRIMARY KEY);
  `);
});

test('supports nested block comments', () => {
  accepts(`
    /* outer comment /* nested DELETE FROM x; */ still inert */
    CREATE TABLE public.safe_table (id UUID PRIMARY KEY);
  `);
});

test('allows DML-like function bodies in dollar quotes', () => {
  accepts(`
    CREATE FUNCTION public.audit_fn() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      INSERT INTO public.audit_logs (id, business_id, action, details)
      VALUES (gen_random_uuid(), NEW.business_id, 'CREATE', '{}');
      RETURN NEW;
    END;
    $function$;
  `);
});

for (const statement of [
  'DROP TABLE public.safe_table;',
  'TRUNCATE TABLE public.safe_table;',
  'DELETE FROM public.safe_table;',
  'UPDATE public.safe_table SET id = id;',
  'INSERT INTO public.safe_table (id) VALUES (gen_random_uuid());',
  'MERGE INTO public.safe_table USING public.other_table ON (true) WHEN MATCHED THEN UPDATE SET id = public.safe_table.id;',
  'ALTER TABLE public.safe_table DROP COLUMN obsolete;',
]) {
  test(`rejects ${statement.split(/\s+/u)[0]} as executable destructive/DML SQL`, () => {
    rejects(statement, 'FORBIDDEN_EXECUTABLE_STATEMENT');
  });
}

test('rejects DML hidden behind a CTE', () => {
  rejects(
    'WITH removed AS (DELETE FROM public.safe_table RETURNING id) SELECT * FROM removed;',
    'FORBIDDEN_EXECUTABLE_STATEMENT',
  );
  rejects(
    'WITH source AS (SELECT 1) UPDATE public.safe_table SET id = id;',
    'FORBIDDEN_EXECUTABLE_STATEMENT',
  );
});

test('rejects every defined R002 identifier outside inert SQL text', () => {
  for (const identifier of R002_IDENTIFIERS) {
    rejects(`CREATE TABLE public.${identifier} (id UUID PRIMARY KEY);`, 'R002_IDENTIFIER_DETECTED');
  }
});

test('fails closed on unterminated lexical and structural input', () => {
  rejects("COMMENT ON TABLE public.safe_table IS 'unterminated;", 'UNTERMINATED_STRING_LITERAL');
  rejects('CREATE TABLE "unterminated (id UUID);', 'UNTERMINATED_QUOTED_IDENTIFIER');
  rejects('CREATE FUNCTION public.fn() RETURNS void AS $body$ BEGIN SELECT 1; END;', 'UNTERMINATED_DOLLAR_QUOTED_BODY');
  rejects('/* unterminated comment', 'UNTERMINATED_BLOCK_COMMENT');
  rejects('CREATE TABLE public.safe_table (id UUID;', 'AMBIGUOUS_STATEMENT_STRUCTURE');
  rejects('CREATE TABLE public.safe_table (id UUID)', 'UNTERMINATED_STATEMENT');
  rejects('\\i untrusted.sql', 'UNSUPPORTED_PSQL_META_COMMAND');
});

console.log(`R001 schema dump inspector: ${passed}/${passed} tests passed.`);

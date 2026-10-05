#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const R002_IDENTIFIERS = Object.freeze([
  'staff_credentials',
  'staff_security_sessions',
  'device_pairing_attempts',
  'idx_devices_device_id_status',
  'idx_staff_security_sessions_active',
  'device_pairing_codes_bcrypt_hash',
  'pairing_code_hash',
  'created_by_user_id',
  'created_by_staff_id',
  'session_token_hash',
  'set_staff_pin',
  'verify_staff_pin',
  'revoke_staff_security_session',
  'create_device_pairing_code',
  'pair_device_with_code',
  'verify_device_status',
  'revoke_device',
  'get_device_bootstrap',
  'r002_crypt',
  'r002_gen_salt',
  'r002_random_bytes',
]);

const R002_IDENTIFIER_SET = new Set(R002_IDENTIFIERS);
const DML_ROOTS = new Set(['DELETE', 'INSERT', 'MERGE', 'TRUNCATE', 'UPDATE']);
const DIRECTLY_FORBIDDEN_ROOTS = new Set(['DROP', ...DML_ROOTS]);

export class SchemaDumpInspectionError extends Error {
  constructor(code, line, column, detail) {
    super(`${code} at ${line}:${column}${detail ? `: ${detail}` : ''}`);
    this.name = 'SchemaDumpInspectionError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

function isIdentifierStart(character) {
  return /[A-Za-z_\u0080-\uffff]/u.test(character);
}

function isIdentifierContinue(character) {
  return /[A-Za-z0-9_$\u0080-\uffff]/u.test(character);
}

function isDollarTagContinue(character) {
  return /[A-Za-z0-9_\u0080-\uffff]/u.test(character);
}

function isLineBreak(character) {
  return character === '\n' || character === '\r';
}

function normalizeUnquotedIdentifier(value) {
  return value.toLowerCase();
}

function isForbiddenR002Identifier(token) {
  if (token.quoted) {
    return R002_IDENTIFIER_SET.has(token.value);
  }
  return R002_IDENTIFIER_SET.has(normalizeUnquotedIdentifier(token.value));
}

function isKeyword(token, keyword) {
  return !token.quoted && token.value.toUpperCase() === keyword;
}

class Scanner {
  constructor(sql) {
    this.sql = sql;
    this.index = 0;
    this.line = 1;
    this.column = 1;
    this.parenthesisDepth = 0;
    this.tokens = [];
    this.statements = [];
    this.statementHasExecutableContent = false;
  }

  at(offset = 0) {
    return this.sql[this.index + offset];
  }

  position() {
    return { line: this.line, column: this.column };
  }

  advance() {
    const character = this.at();
    if (character === undefined) return;
    this.index += 1;
    if (character === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
  }

  advanceCount(count) {
    for (let offset = 0; offset < count; offset += 1) this.advance();
  }

  error(code, detail) {
    const { line, column } = this.position();
    throw new SchemaDumpInspectionError(code, line, column, detail);
  }

  skipLineComment() {
    this.advanceCount(2);
    while (this.at() !== undefined && !isLineBreak(this.at())) this.advance();
  }

  skipBlockComment() {
    const start = this.position();
    let depth = 0;

    while (this.at() !== undefined) {
      if (this.at() === '/' && this.at(1) === '*') {
        depth += 1;
        this.advanceCount(2);
        continue;
      }
      if (this.at() === '*' && this.at(1) === '/') {
        depth -= 1;
        this.advanceCount(2);
        if (depth === 0) return;
        continue;
      }
      this.advance();
    }

    throw new SchemaDumpInspectionError(
      'UNTERMINATED_BLOCK_COMMENT',
      start.line,
      start.column,
      'nested block comments must close before inspection can continue',
    );
  }

  skipSingleQuotedString() {
    const start = this.position();
    this.advance();

    while (this.at() !== undefined) {
      if (this.at() === "'") {
        this.advance();
        if (this.at() === "'") {
          this.advance();
          continue;
        }
        return;
      }
      if (this.at() === '\\') {
        // E'' literals can use backslash escapes. Skipping the escaped byte is
        // conservative and prevents a quote in the escape sequence ending the
        // literal early.
        this.advance();
        if (this.at() !== undefined) this.advance();
        continue;
      }
      this.advance();
    }

    throw new SchemaDumpInspectionError(
      'UNTERMINATED_STRING_LITERAL',
      start.line,
      start.column,
      'single-quoted literal is not closed',
    );
  }

  readQuotedIdentifier() {
    const start = this.position();
    let value = '';
    this.advance();

    while (this.at() !== undefined) {
      if (this.at() === '"') {
        this.advance();
        if (this.at() === '"') {
          value += '"';
          this.advance();
          continue;
        }
        this.tokens.push({ ...start, value, quoted: true, depth: this.parenthesisDepth });
        this.statementHasExecutableContent = true;
        return;
      }
      value += this.at();
      this.advance();
    }

    throw new SchemaDumpInspectionError(
      'UNTERMINATED_QUOTED_IDENTIFIER',
      start.line,
      start.column,
      'double-quoted identifier is not closed',
    );
  }

  readDollarDelimiter() {
    if (this.at() !== '$') return null;
    if (this.at(1) === '$') return '$$';
    if (!isIdentifierStart(this.at(1) || '')) return null;

    let cursor = this.index + 2;
    while (isDollarTagContinue(this.sql[cursor] || '')) cursor += 1;
    if (this.sql[cursor] !== '$') return null;
    return this.sql.slice(this.index, cursor + 1);
  }

  skipDollarQuotedString(delimiter) {
    const start = this.position();
    this.advanceCount(delimiter.length);

    while (this.at() !== undefined) {
      if (this.sql.startsWith(delimiter, this.index)) {
        this.advanceCount(delimiter.length);
        return;
      }
      this.advance();
    }

    throw new SchemaDumpInspectionError(
      'UNTERMINATED_DOLLAR_QUOTED_BODY',
      start.line,
      start.column,
      `missing closing ${delimiter} delimiter`,
    );
  }

  readIdentifier() {
    const start = this.position();
    let value = '';
    while (isIdentifierContinue(this.at() || '')) {
      value += this.at();
      this.advance();
    }
    this.tokens.push({ ...start, value, quoted: false, depth: this.parenthesisDepth });
    this.statementHasExecutableContent = true;
  }

  finishStatement() {
    if (this.parenthesisDepth !== 0) {
      this.error('AMBIGUOUS_STATEMENT_STRUCTURE', 'semicolon encountered before parentheses close');
    }
    if (this.statementHasExecutableContent || this.tokens.length > 0) {
      this.statements.push(this.tokens);
    }
    this.tokens = [];
    this.statementHasExecutableContent = false;
  }

  scan() {
    while (this.at() !== undefined) {
      const character = this.at();

      if (/\s/u.test(character)) {
        this.advance();
        continue;
      }
      if (character === '-' && this.at(1) === '-') {
        this.skipLineComment();
        continue;
      }
      if (character === '/' && this.at(1) === '*') {
        this.skipBlockComment();
        continue;
      }
      if (character === "'") {
        this.skipSingleQuotedString();
        this.statementHasExecutableContent = true;
        continue;
      }
      if (character === '"') {
        this.readQuotedIdentifier();
        continue;
      }
      if (character === '$') {
        const delimiter = this.readDollarDelimiter();
        if (delimiter) {
          this.skipDollarQuotedString(delimiter);
          this.statementHasExecutableContent = true;
          continue;
        }
      }
      if (character === ';') {
        this.finishStatement();
        this.advance();
        continue;
      }
      if (character === '(') {
        this.parenthesisDepth += 1;
        this.statementHasExecutableContent = true;
        this.advance();
        continue;
      }
      if (character === ')') {
        if (this.parenthesisDepth === 0) {
          this.error('AMBIGUOUS_STATEMENT_STRUCTURE', 'unmatched closing parenthesis');
        }
        this.parenthesisDepth -= 1;
        this.statementHasExecutableContent = true;
        this.advance();
        continue;
      }
      if (character === '\\') {
        this.error('UNSUPPORTED_PSQL_META_COMMAND', 'psql meta commands are not accepted in an R001 schema dump');
      }
      if (isIdentifierStart(character)) {
        this.readIdentifier();
        continue;
      }

      this.statementHasExecutableContent = true;
      this.advance();
    }

    if (this.parenthesisDepth !== 0) {
      this.error('AMBIGUOUS_STATEMENT_STRUCTURE', 'unclosed parenthesis at end of input');
    }
    if (this.statementHasExecutableContent || this.tokens.length > 0) {
      this.error('UNTERMINATED_STATEMENT', 'executable SQL must end with a semicolon');
    }

    return this.statements;
  }
}

function inspectStatement(tokens, statementNumber) {
  for (const token of tokens) {
    if (isForbiddenR002Identifier(token)) {
      throw new SchemaDumpInspectionError(
        'R002_IDENTIFIER_DETECTED',
        token.line,
        token.column,
        `statement ${statementNumber} references ${token.value}`,
      );
    }
  }

  const root = tokens.find((token) => !token.quoted);
  if (!root) return;
  const rootKeyword = root.value.toUpperCase();

  if (DIRECTLY_FORBIDDEN_ROOTS.has(rootKeyword)) {
    throw new SchemaDumpInspectionError(
      'FORBIDDEN_EXECUTABLE_STATEMENT',
      root.line,
      root.column,
      `statement ${statementNumber} begins with ${rootKeyword}`,
    );
  }

  if (rootKeyword === 'WITH' || rootKeyword === 'EXPLAIN') {
    const dmlToken = tokens.find((token) => !token.quoted && DML_ROOTS.has(token.value.toUpperCase()));
    if (dmlToken) {
      throw new SchemaDumpInspectionError(
        'FORBIDDEN_EXECUTABLE_STATEMENT',
        dmlToken.line,
        dmlToken.column,
        `statement ${statementNumber} contains ${dmlToken.value.toUpperCase()} behind ${rootKeyword}`,
      );
    }
  }

  if (rootKeyword === 'ALTER') {
    const dropToken = tokens.find((token) => isKeyword(token, 'DROP'));
    if (dropToken) {
      throw new SchemaDumpInspectionError(
        'FORBIDDEN_EXECUTABLE_STATEMENT',
        dropToken.line,
        dropToken.column,
        `statement ${statementNumber} contains destructive ALTER ... DROP`,
      );
    }
  }
}

export function inspectR001SchemaDump(sql) {
  if (typeof sql !== 'string') {
    throw new TypeError('R001 schema dump inspection requires a string');
  }
  const statements = new Scanner(sql).scan();
  statements.forEach((tokens, index) => inspectStatement(tokens, index + 1));
  return { statementCount: statements.length };
}

export { R002_IDENTIFIERS };

async function runCli() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath || process.argv.length !== 3) {
    console.error('Usage: node scripts/inspect-r001-schema-dump.mjs <schema-dump.sql>');
    process.exitCode = 64;
    return;
  }

  try {
    const result = inspectR001SchemaDump(await readFile(inputPath, 'utf8'));
    console.log(`R001 schema dump inspection passed (${result.statementCount} executable statements).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown inspection failure';
    console.error(`R001 schema dump inspection failed: ${message}`);
    process.exitCode = 1;
  }
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) await runCli();

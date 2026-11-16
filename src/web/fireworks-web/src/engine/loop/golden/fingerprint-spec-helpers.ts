/**
 * File access for the fingerprint specs (regular and daily). Specs only: nothing in the app
 * imports this. Node's fs is reached through `process.getBuiltinModule`, as in
 * `schema-fixtures.spec.ts`, so the bundle imports no Node builtin and needs no @types/node. The
 * cwd under `@angular/build:unit-test` is src/web/fireworks-web.
 */
import {
  caseInput,
  diffFingerprint,
  fingerprintShow,
  inputDigest,
  type FingerprintCase,
  type ShowFingerprint,
} from './show-fingerprint';

interface NodeFs {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

const fs = process.getBuiltinModule('node:fs');
export const GOLDEN_DIR = `${process.cwd()}/src/engine/loop/golden/fingerprints`;
export const SHOW_FIXTURES = `${process.cwd()}/../../../schema/fixtures/valid/show`;

export interface Golden {
  readonly header: { readonly history: readonly { readonly reason: string }[] };
  readonly case: FingerprintCase;
  readonly inputDigest: number;
  readonly fingerprint: ShowFingerprint;
}

export const goldenNames = (): string[] =>
  fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));

export const fixtureNames = (): string[] =>
  fs
    .readdirSync(SHOW_FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));

export function readGolden(name: string): Golden | null {
  const file = `${GOLDEN_DIR}/${name}.json`;
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Golden) : null;
}

export function readFixture(name: string): unknown {
  const file = `${SHOW_FIXTURES}/${name}.json`;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** One run of a case, in the shape a golden stores. */
export function runCase(c: FingerprintCase) {
  const doc = caseInput(c, readFixture);
  return { case: c, inputDigest: inputDigest(doc), fingerprint: fingerprintShow(doc, c.run) };
}

/**
 * Differences between a case's golden and a fresh run, with a hint about what moved. Empty when
 * they agree. A JSON round trip makes the TS case comparable with the parsed one.
 */
export function checkCase(c: FingerprintCase): string[] {
  const golden = readGolden(c.name);
  if (!golden) return [`no golden ${c.name}.json: node tools/fingerprints/record.mjs --reason "…"`];
  const now = JSON.parse(JSON.stringify(runCase(c)));
  const diff = diffFingerprint(
    { case: golden.case, inputDigest: golden.inputDigest, fingerprint: golden.fingerprint },
    now,
  );
  if (!diff.length) return [];
  const hint = diff.some((d) => d.startsWith('inputDigest') || d.startsWith('case'))
    ? 'the case or its input document changed'
    : 'the sim or loop changed how this show plays';
  return [`${c.name}: ${hint}; re-record only by reviewed change (schema.md §8.1)`, ...diff];
}

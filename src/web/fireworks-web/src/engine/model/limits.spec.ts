// @vitest-environment node
/**
 * Limits drift guard (docs/fireworks-app/schema.md §5.2): `limits.ts` (the source, via
 * `SCHEMA_LIMIT_ROWS`), `schema/limits.json` (the mirror) and the schema.md §5.1 table must agree.
 */
import { SCHEMA_LIMIT_ROWS } from './limits';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

const fs = process.getBuiltinModule('node:fs');
const REPO = `${process.cwd()}/../../..`;

function tableRows(markdown: string): Record<string, unknown> {
  const begin = markdown.indexOf('<!-- limits:begin -->');
  const end = markdown.indexOf('<!-- limits:end -->');
  if (begin < 0 || end < begin) throw new Error('schema.md: limits markers not found');
  const rows: Record<string, unknown> = {};
  for (const line of markdown.slice(begin, end).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 6 || cells[1] === 'Key' || cells[1].startsWith('---')) continue;
    const [, key, min, max, integer] = cells;
    const asNum = (v: string) => (/^-?[\d.]+$/.test(v) ? Number(v) : v);
    rows[key] = { min: asNum(min), max: asNum(max), integer: integer === 'yes' };
  }
  return rows;
}

describe('limits drift guard', () => {
  const json = JSON.parse(fs.readFileSync(`${REPO}/schema/limits.json`, 'utf8')) as unknown;

  it('limits.ts matches schema/limits.json', () => {
    expect(SCHEMA_LIMIT_ROWS).toEqual(json);
  });

  it('the schema.md §5.1 table matches schema/limits.json', () => {
    const doc = fs.readFileSync(`${REPO}/docs/fireworks-app/schema.md`, 'utf8');
    const rows = tableRows(doc);
    expect(Object.keys(rows).length).toBeGreaterThan(0);
    expect(rows).toEqual(json);
  });
});

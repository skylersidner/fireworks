// @vitest-environment node
/**
 * Structure checks for the designer (acceptance 2c.2, 2c.7, 2c.8), read from the source tree.
 * Fails on: a legacy forms API or a ControlValueAccessor in the designer or the shared controls;
 * a presentational component that injects the store; the designer touching identity or HTTP.
 */
interface Dirent {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const APP = `${process.cwd()}/src/app`;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(APP.length + 1);
const designer = walk(`${APP}/features/designer`);
const controls = walk(`${APP}/shared`);
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('designer structure', () => {
  it('sees the files it checks', () => {
    expect(designer.some((p) => p.endsWith('shell-designer.store.ts'))).toBe(true);
    expect(controls.some((p) => p.endsWith('range-row.ts'))).toBe(true);
  });

  it('uses Signal Forms only: no ReactiveFormsModule, FormGroup/FormControl, or ControlValueAccessor', () => {
    // Code forms only: doc comments may name what is avoided, and '@angular/forms/signals' is the
    // one allowed entry point.
    const banned =
      /ReactiveFormsModule|\bFormsModule\b|new Form(Group|Control|Array)\b|FormBuilder|implements[^{]*\bControlValueAccessor\b|NG_VALUE_ACCESSOR|from '@angular\/forms'/;
    const offenders = [...designer, ...controls].filter((p) => banned.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the page injects the store; presentational components take inputs', () => {
    const offenders = designer.filter((p) => /inject\(ShellDesignerStore\)/.test(read(p))).map(rel);
    expect(offenders).toEqual(['features/designer/pages/designer-page/designer-page.ts']);
  });

  it('reads nothing from SessionService and makes no HTTP calls (2c.8)', () => {
    const offenders = designer
      .filter((p) =>
        /inject\((SessionService|HttpClient|ApiService)\)|from '[^']*core\/(session|api)'|@angular\/common\/http/.test(
          read(p),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('never binds innerHTML (user text is the shell name)', () => {
    const offenders = [...designer, ...controls].filter((p) => /innerHTML/i.test(read(p))).map(rel);
    expect(offenders).toEqual([]);
  });
});

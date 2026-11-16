// @vitest-environment node
/**
 * App-wide structure checks for untrusted creation data (Boo C1, C2, C4, C5, C10, C14), read from
 * the source tree: every non-spec `.ts` and `.html` under `src/app` and `src/engine`. Names are the
 * only free text a stranger controls, and a share link delivers them to whoever opens it.
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
const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length + 1);
const files = [...walk(`${SRC}/app`), ...walk(`${SRC}/engine`)].map((p) => ({
  path: rel(p),
  text: fs.readFileSync(p, 'utf8'),
}));

/**
 * Boo C1: sinks that turn a string into markup or code. Matched on code, so a comment naming one
 * would also trip it; none does today, and the fix is to reword the comment. Case-insensitive:
 * Angular's compiler remaps `[innerHtml]` to the `innerHTML` property (`DOM_PROPERTY_REMAPPING` in
 * `@angular/compiler`), so a case-sensitive ban misses a working binding.
 */
export const UNSAFE_SINK =
  /innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc|bypassSecurityTrust|DomSanitizer|setProperty\([^)]*['"]innerHTML|\bHTMLText\b|\beval\(|new Function\b|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe|\bDOMParser\b/i;

/**
 * Boo C2: an attribute or property that the browser reads as a URL (or as a document, for srcdoc).
 * `formaction` is one of the names Angular remaps (to `formAction`), so this is matched
 * case-insensitively too.
 */
const URL_ATTR =
  '(?:attr\\.)?(?:href|xlink:href|src|srcset|ngSrc|ngSrcset|srcdoc|action|formaction|poster|routerLink)';

/**
 * Boo C2 (Phase 6 F2): every dynamic URL binding, in every Angular spelling: `[href]="…"`,
 * `bind-href="…"`, `bindon-…`, `href="…{{ … }}…"` (interpolation is a property binding), a
 * `host: { '[attr.href]': '…' }` entry and `@HostBinding('attr.href')`. The value may use either
 * quote and span lines. A plain `href="/"` with no interpolation is static and not listed.
 * This replaced a `\bname\b` heuristic that missed `shellNameOf(cue)`, `activeName()`, `o.label`
 * and `d.title`: the rule is now an allowlist of shapes, not a list of name spellings.
 */
export interface UrlBinding {
  readonly form: 'bound' | 'interpolated' | 'host' | 'HostBinding';
  readonly attr: string;
  /** The bound expression, or the whole attribute value for an interpolation; whitespace collapsed. */
  readonly expr: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function urlBindings(text: string): UrlBinding[] {
  const out: UrlBinding[] = [];
  const bound = new RegExp(
    `(?:\\[|\\bbind-|\\bbindon-)(${URL_ATTR})\\]?\\s*=\\s*(["'])((?:(?!\\2)[\\s\\S])*)\\2`,
    'gi',
  );
  for (const m of text.matchAll(bound)) out.push({ form: 'bound', attr: m[1], expr: squash(m[3]) });
  const plain = new RegExp(
    `(?:^|[\\s<])(${URL_ATTR})\\s*=\\s*(["'])((?:(?!\\2)[\\s\\S])*)\\2`,
    'gi',
  );
  for (const m of text.matchAll(plain)) {
    if (m[3].includes('{{')) out.push({ form: 'interpolated', attr: m[1], expr: squash(m[3]) });
  }
  const host = new RegExp(
    `["']\\[(${URL_ATTR})\\]["']\\s*:\\s*(["'])((?:(?!\\2)[\\s\\S])*)\\2`,
    'gi',
  );
  for (const m of text.matchAll(host)) out.push({ form: 'host', attr: m[1], expr: squash(m[3]) });
  const hostBinding = new RegExp(`@HostBinding\\(\\s*["'](${URL_ATTR})["']`, 'gi');
  for (const m of text.matchAll(hostBinding)) {
    out.push({ form: 'HostBinding', attr: m[1], expr: '(class member)' });
  }
  return out;
}

/** A checked share code: `code`, `shareCode`, or a member path or signal call ending in one. */
const CODE_EXPR = String.raw`(?:[A-Za-z_$][\w$]*(?:\(\))?\.)*(?:shareCode|code)(?:\(\))?`;
const LITERAL = String.raw`'[^'\\]*'|"[^"\\]*"`;
const ELEMENT = `(?:${LITERAL}|${CODE_EXPR})`;
const SAFE_BOUND = new RegExp(
  `^(?:${LITERAL}|${CODE_EXPR}|\\[\\s*(?:${ELEMENT}(?:\\s*,\\s*${ELEMENT})*)?\\s*\\])$`,
);
const SAFE_INTERPOLATION = new RegExp(`^${CODE_EXPR}$`);

/**
 * The only shapes a URL binding may take: a string literal, a checked code, or a route array whose
 * parts are those; an interpolation may hold only a code. Anything else (a name, a label, a title,
 * a function call, concatenation, a HostBinding) is unsafe.
 */
export function isSafeUrlBinding(b: UrlBinding): boolean {
  if (b.form === 'HostBinding') return false;
  if (b.form === 'interpolated') {
    const parts = [...b.expr.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim());
    return parts.length > 0 && parts.every((p) => SAFE_INTERPOLATION.test(p));
  }
  return SAFE_BOUND.test(b.expr);
}

/** True when `text` has a URL binding outside the safe shapes (the negative controls use this). */
export const hasUnsafeUrlBinding = (text: string) =>
  urlBindings(text).some((b) => !isSafeUrlBinding(b));

const describeBinding = (path: string, b: UrlBinding) => `${path}: ${b.form} ${b.attr}=${b.expr}`;

/**
 * Boo C14 (Phase 6 F2): router navigation on any receiver (`this.r.`, `inject(Router).`, a bare
 * destructured `navigate(`), plus `parseUrl(` and `createUrlTree(`, whose result a guard can return.
 * Each call is listed as `fn(first argument)`.
 */
export function navigationCalls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(navigateByUrl|navigate|parseUrl|createUrlTree)\s*\(/g)) {
    out.push(`${m[1]}(${firstArgument(text, (m.index ?? 0) + m[0].length)})`);
  }
  return out;
}

/** The first argument of a call whose `(` ends just before `start`, by bracket depth and quotes. */
function firstArgument(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return squash(text.slice(start, i));
      depth--;
    } else if (c === ',' && depth === 0) return squash(text.slice(start, i));
  }
  return squash(text.slice(start));
}

/** A navigation target that is a literal route, or the fixed `/c` route with a checked code. */
export const SAFE_NAVIGATION =
  /^(?:navigateByUrl|navigate|parseUrl|createUrlTree)\((?:'\/'|'\/show'|\['\/c', code\]|\[\])\)$/;

/** Browser navigation that bypasses the router; none ships. `location.reload()` and `.origin` are fine. */
export const BROWSER_NAVIGATION =
  /\blocation\s*\.\s*(?:assign|replace)\s*\(|\blocation\s*\.\s*href\s*=(?!=)|\b(?:window|document|globalThis|self)\s*\.\s*location\s*=(?!=)|\b(?:window|globalThis|self)\s*\.\s*open\s*\(/;

describe('untrusted text and links (Boo C1, C2, C4, C5, C10, C14)', () => {
  it('sees the files it checks, in every surface', () => {
    for (const f of [
      'app/features/player/pages/player-page/player-page.html',
      'app/features/mine/pages/mine-page/mine-page.html',
      'app/features/designer/pages/open-link-page/open-link-page.ts',
      'app/shared/save-bar/save-bar.ts',
      'app/core/creations.ts',
      'engine/render/pixi-renderer.ts',
    ]) {
      expect(
        files.some((x) => x.path === f),
        f,
      ).toBe(true);
    }
  });

  it('C1: no file uses an HTML or code sink', () => {
    expect(files.filter((f) => UNSAFE_SINK.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('C1: the ban catches each sink (negative controls)', () => {
    for (const bad of [
      '<span [innerHTML]="name()"></span>',
      'el.outerHTML = x',
      "el.insertAdjacentHTML('beforeend', x)",
      'document.write(x)',
      '<iframe [srcdoc]="x">',
      'sanitizer.bypassSecurityTrustHtml(x)',
      'inject(DomSanitizer)',
      "renderer.setProperty(el, 'innerHTML', x)",
      'new HTMLText({ text: name })',
      'eval(code)',
      'new Function(code)',
      // Boo F1: Angular remaps innerHtml to innerHTML, so this binding works.
      '<span [innerHtml]="p.name"></span>',
      '<span [INNERHTML]="p.name"></span>',
      '<span bind-innerHtml="p.name"></span>',
      '<span innerHtml="{{ p.name }}"></span>',
      "host: { '[innerHtml]': 'name()' }",
      "@HostBinding('innerHtml') html = ''",
      '<div [outerHtml]="x">',
      "el.insertAdjacentHtml('beforeend', x)",
      '<iframe [srcDoc]="x">',
      '<iframe [attr.srcdoc]="x">',
      "renderer.setProperty(el, 'innerHtml', x)",
      'document.createRange().createContextualFragment(x)',
      'el.setHTMLUnsafe(x)',
      'Document.parseHTMLUnsafe(x)',
      "new DOMParser().parseFromString(x, 'text/html')",
    ]) {
      expect(UNSAFE_SINK.test(bad), bad).toBe(true);
    }
  });

  /** Every dynamic URL binding that ships (Phase 6). Anything else, safe-shaped or not, fails. */
  const SHIPPED_URL_BINDINGS = [
    "app/features/mine/pages/mine-page/mine-page.html: bound routerLink=['/c', card.item.shareCode]",
    "app/features/mine/pages/mine-page/mine-page.html: bound routerLink=['/s', card.item.shareCode]",
  ];

  it('C2: every URL binding is a shipped one, and each is literal or code-shaped', () => {
    const all = files.flatMap((f) => urlBindings(f.text).map((b) => ({ path: f.path, b })));
    expect(
      all.filter(({ b }) => !isSafeUrlBinding(b)).map(({ path, b }) => describeBinding(path, b)),
    ).toEqual([]);
    expect(all.map(({ path, b }) => describeBinding(path, b)).sort()).toEqual(SHIPPED_URL_BINDINGS);
  });

  it('C2: the URL rule catches each spelling and each non-code value (negative controls)', () => {
    for (const bad of [
      // Boo Phase 6 F2: the builder's name carriers, none of which says "name".
      '<a [href]="shellNameOf(cue)">',
      '<a [href]="activeName()">',
      '<a [href]="o.label">',
      '<a [href]="d.title">',
      '<a href="{{ shellNameOf(cue) }}">',
      '<a [routerLink]="[\'/c\', o.label]">',
      '<a [routerLink]="[\'/s\', shellNameOf(cue)]">',
      '<a [routerLink]="\'/s/\' + code">',
      '<a href="/s/{{ code }}/{{ d.title }}">',
      '<a [href]="url">',
      '<a [href]="codeName">',
      "@HostBinding('attr.href') link = '';",
      // Phase 5 spellings, all still caught.
      '<a [href]="p.name">',
      '<img [src]="name()">',
      '<a [routerLink]="[\'/c\', p.name]">',
      '<a [attr.href]="p.name">',
      '<img [attr.src]="p.name">',
      '<a href="{{ p.name }}">',
      '<a href="/s/{{ p.name }}">',
      "<a href='{{p.name}}'>",
      '<a\n  class="x"\n  href="{{\n    p.name\n  }}"\n>',
      '<img src="{{ name() }}">',
      '<img srcset="{{ p.name }} 2x">',
      '<img ngSrc="{{ p.name }}">',
      '<img ngSrcset="{{ p.name }} 2x">',
      '<iframe srcdoc="{{ p.name }}">',
      '<form action="{{ p.name }}">',
      '<button formaction="{{ p.name }}">',
      '<button [formaction]="p.name">',
      '<button [formAction]="p.name">',
      '<video poster="{{ p.name }}">',
      '<use xlink:href="{{ p.name }}">',
      '<use [attr.xlink:href]="p.name">',
      '<a routerLink="/c/{{ p.name }}">',
      '<a [routerLink]="\'/c/\' + p.name">',
      '<a [HREF]="p.name">',
      '<a HREF="{{ p.name }}">',
      '<a bind-href="p.name">',
      '<a bindon-href="p.name">',
      "<a [href]='p.name'>",
      "host: { '[attr.href]': 'name()' }",
      "host: { '[attr.href]': 'o.label' }",
    ]) {
      expect(hasUnsafeUrlBinding(bad), bad).toBe(true);
    }
  });

  it('C2: the URL rule passes the shipped and literal shapes (positive controls)', () => {
    for (const ok of [
      '<a [routerLink]="[\'/c\', card.item.shareCode]">',
      '<a\n  [routerLink]="[\'/s\', card.item.shareCode]"\n  class="btn"\n>',
      '<a routerLink="/mine">',
      '<a routerLink="/">',
      '<a href="/">',
      '<a [routerLink]="\'/show\'">',
      '<a [routerLink]="[\'/c\', code]">',
      '<a [routerLink]="[\'/s\', shareCode()]">',
      '<a [attr.title]="p.name" [attr.aria-label]="p.name" routerLink="/">',
      '<a routerLink="/">{{ p.name }}</a>',
      '<span title="{{ p.name }}">',
      '<a [title]="o.label" [attr.aria-label]="d.title">',
      // Literal text after a closed interpolation is not part of the binding.
      '<a href="/s/{{ card.item.shareCode }}#name">',
      "host: { '[attr.title]': 'name()' }",
    ]) {
      expect(hasUnsafeUrlBinding(ok), ok).toBe(false);
    }
  });

  it('C10: remixedFrom appears only in the contract mirror, never in a template or copy', () => {
    // Spec support (app/testing) builds responses, so it names the field; it never ships.
    const readers = files
      .filter((f) => !f.path.startsWith('app/testing/') && /remixedFrom/.test(f.text))
      .map((f) => f.path);
    expect(readers).toEqual(['app/core/models.ts']);
  });

  it('C4/C5: a shared creation is fetched only through openCreation (pattern, kind, upgrade, normalize)', () => {
    const fetchers = files.filter((f) => /\.getByShareCode\(/.test(f.text)).map((f) => f.path);
    expect(fetchers).toEqual(['app/core/open-creation.ts']);
    const openers = files
      .filter((f) => /\bopenCreation\(/.test(f.text) && !f.path.endsWith('open-creation.ts'))
      .map((f) => f.path)
      .sort();
    expect(openers).toEqual([
      'app/features/designer/pages/open-link-page/open-link-page.ts',
      'app/features/player/pages/player-page/player-page.ts',
      // The Show Builder's "My shells" add (phase-6.md §13.1; Peach N2).
      'app/features/show/pages/show-builder-page/show-library.ts',
    ]);
  });

  /** Every navigation call that ships, by file and first argument (Phase 6). */
  const SHIPPED_NAVIGATION = [
    "app/features/designer/pages/open-link-page/open-link-page.ts: navigateByUrl('/')",
    "app/features/designer/pages/open-link-page/open-link-page.ts: navigateByUrl('/')",
    "app/features/designer/pages/open-link-page/open-link-page.ts: navigateByUrl('/show')",
    "app/features/designer/pages/open-link-page/open-link-page.ts: navigateByUrl('/show')",
    'app/features/mine/pages/mine-page/mine-page.ts: navigate([])',
    "app/features/player/pages/player-page/player-page.ts: navigate(['/c', code])",
    "app/features/player/pages/player-page/player-page.ts: navigateByUrl('/')",
    "app/pages/link-not-found/link-not-found-page.ts: navigateByUrl('/')",
  ];

  it('C14: every navigation target is a literal or a fixed route with a checked code', () => {
    const calls = files.flatMap((f) => navigationCalls(f.text).map((c) => `${f.path}: ${c}`));
    expect(calls.filter((c) => !SAFE_NAVIGATION.test(c.slice(c.indexOf(': ') + 2)))).toEqual([]);
    expect(calls.sort()).toEqual(SHIPPED_NAVIGATION);
    expect(files.filter((f) => BROWSER_NAVIGATION.test(f.text)).map((f) => f.path)).toEqual([]);
    expect(files.some((f) => /returnUrl|queryParams\.(next|redirect)/.test(f.text))).toBe(false);
  });

  it('C14: the navigation rule catches any receiver and the browser sinks (negative controls)', () => {
    const unsafeNav = (src: string) =>
      navigationCalls(src).some((c) => !SAFE_NAVIGATION.test(c)) || BROWSER_NAVIGATION.test(src);
    for (const bad of [
      'void this.r.navigateByUrl(x);',
      'inject(Router).navigateByUrl(url);',
      'void inject(Router).navigateByUrl(this.route.snapshot.queryParamMap.get("next") ?? "/");',
      'const { navigate } = this.router; navigate([target]);',
      "this.router.navigate(['/c', p.name]);",
      "this.router.navigate(['/s', code]);",
      "this.router.navigate(['/c', code, extra]);",
      'this.router.navigateByUrl(`/c/${code}`);',
      'this.router.navigateByUrl(\n  url,\n  { replaceUrl: true },\n);',
      'this.router.navigateByUrl(this.router.parseUrl(u));',
      "return router.parseUrl(route.queryParamMap.get('next'));",
      'router.createUrlTree([u]);',
      '<button (click)="router.navigateByUrl(o.label)">',
      'location.assign(x);',
      'window.location.assign(x);',
      'location.replace(x);',
      'location.href = x;',
      'window.location.href=x;',
      'document.location = x;',
      'window.location = x;',
      'window.open(x);',
      'globalThis.open(x, "_blank");',
    ]) {
      expect(unsafeNav(bad), bad).toBe(true);
    }
    for (const ok of [
      "void this.router.navigateByUrl('/', { replaceUrl: true });",
      "void this.router.navigateByUrl('/show', { replaceUrl: true });",
      "void this.router.navigate(['/c', code]);",
      'void this.router.navigate([], {\n  queryParams: { kind: k },\n  replaceUrl: true,\n});',
      'location.reload();',
      'const link = `${location.origin}/s/${source.shareCode}`;',
      'if (location.href === x) return;',
    ]) {
      expect(unsafeNav(ok), ok).toBe(false);
    }
  });
});

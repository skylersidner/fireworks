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
 * Boo C2: a name reaching a URL attribute, in every Angular spelling: `[href]="…name…"`,
 * `bind-href="…"`, `bindon-…`, `href="…{{ …name… }}…"` (interpolation is a property binding), and a
 * `host: { '[attr.href]': '…name…' }` entry. The value may use either quote and span lines.
 */
export const NAME_IN_URL = new RegExp(
  [
    `(?:\\[|\\bbind-|\\bbindon-)${URL_ATTR}\\]?\\s*=\\s*(["'])(?:(?!\\1)[\\s\\S])*\\bname\\b`,
    `(?:^|[\\s<])${URL_ATTR}\\s*=\\s*(["'])(?:(?!\\2)[\\s\\S])*\\{\\{(?:(?!\\}\\})[\\s\\S])*\\bname\\b`,
    `["']\\[${URL_ATTR}\\]["']\\s*:\\s*(["'])(?:(?!\\3)[\\s\\S])*\\bname\\b`,
  ].join('|'),
  'i',
);

describe('untrusted text and links (Boo C1, C2, C4, C5, C10, C14)', () => {
  it('sees the files it checks, in every surface', () => {
    for (const f of [
      'app/features/player/pages/player-page/player-page.html',
      'app/features/mine/pages/mine-page/mine-page.html',
      'app/features/designer/pages/open-link-page/open-link-page.ts',
      'app/features/designer/shared/save-bar/save-bar.ts',
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

  it('C2: no name is bound into a URL attribute (href, src, srcdoc, action, routerLink, ...)', () => {
    expect(files.filter((f) => NAME_IN_URL.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('C2: the ban catches each URL spelling (negative controls)', () => {
    for (const bad of [
      '<a [href]="p.name">',
      '<img [src]="name()">',
      '<a [routerLink]="[\'/c\', p.name]">',
      '<a [attr.href]="p.name">',
      '<img [attr.src]="p.name">',
      // Boo F1: interpolation in an attribute is a property binding.
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
    ]) {
      expect(NAME_IN_URL.test(bad), bad).toBe(true);
    }
  });

  it('C2: the URL ban leaves the safe shapes alone (positive controls)', () => {
    for (const ok of [
      '<a [routerLink]="[\'/c\', card.item.shareCode]">',
      '<a routerLink="/mine">',
      '<a href="/">',
      '<a [attr.title]="p.name" [attr.aria-label]="p.name" routerLink="/">',
      '<a routerLink="/">{{ p.name }}</a>',
      '<span title="{{ p.name }}">',
      '<a [href]="url" [title]="p.name">',
      // Literal text after a closed interpolation is not the name.
      '<a href="/s/{{ card.item.shareCode }}#name">',
    ]) {
      expect(NAME_IN_URL.test(ok), ok).toBe(false);
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
    ]);
  });

  it('C14: every navigation target is a literal or a fixed route with a checked code', () => {
    const calls = files.flatMap((f) =>
      [...f.text.matchAll(/router\.(navigateByUrl|navigate)\(([^)]*)\)/g)].map(
        (m) => `${f.path}: ${m[2].trim()}`,
      ),
    );
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      expect(call).toMatch(/: ('\/'|\['\/c', code\]|\[\])(,|$)/);
    }
    expect(files.some((f) => /returnUrl|queryParams\.(next|redirect)/.test(f.text))).toBe(false);
  });
});

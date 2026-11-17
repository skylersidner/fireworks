// Phase 8 B2 client mutants (Luigi; record luigi-phase8-client-sign-in.md). Security and save-path
// code only: the returnUrl rule (Boo A5), the login navigation (A6), the return marker (A41), the
// signed-out Save (A40), If-Match and Replace (schema.md §11.4), the restore refresh (§11.2 writer
// 4), the 401 reload, "Remixed from" (A43) and /mine's zero list calls signed out (A44 page rule).
// Expected: every mutant KILLED, and S3 EQUIVALENT (run 2026-11-16: 17 KILLED, S3 SURVIVED). S3 is
// marked `equivalent` (runner convention, Toad 2026-11-17): the decoded-path check also rejects a
// raw `//` start, the same equivalence Bowser recorded for the server's SafeReturnUrl. G2 (Toad,
// Mario's gate G2) clears the show draft on Sign out; designer-save.spec.ts must kill it.
const SIGN_IN = ['src/app/core/sign-in.spec.ts', 'src/app/pages/signin/signin-page.spec.ts'];
const DESIGNER = 'src/app/features/designer/pages/designer-page/designer-save.spec.ts';
const SHOW = 'src/app/features/show/pages/show-builder-page/show-save.spec.ts';
const SAVE = 'src/app/core/creation-save.spec.ts';
export default {
  kind: 'web',
  description: 'Phase 8 B2: sign-in navigation, return marker, If-Match, Replace, refresh, 401, A43, A44',
  mutants: [
    { id: 'S1', name: 'loginUrl passes an unsafe returnUrl', file: 'src/app/core/sign-in.ts', old: "const target = isSafeInternalUrl(returnPath) ? returnPath : '/';", new: 'const target = returnPath;', specs: SIGN_IN },
    { id: 'S2', name: 'decoded /api not checked', file: 'src/app/core/sign-in.ts', old: 'if (isApi(path) || isApi(decoded)) return false;', new: 'if (isApi(path)) return false;', specs: SIGN_IN },
    { id: 'S3', name: 'raw // second char not checked', file: 'src/app/core/sign-in.ts', old: "if (url.length > 1 && (url[1] === '/' || url[1] === '\\\\')) return false;", new: "if (url.length > 1 && url[1] === '\\\\') return false;", specs: SIGN_IN,
      equivalent: "url[0] is '/', so when the raw url[1] is '/' the path is the same up to index 1 and decoding (only %XX runs, which start with '%') leaves decoded[1] === '/': the decoded check returns false for the same inputs (Mario, Luigi)" },
    { id: 'S4', name: 'marker not deleted on read', file: 'src/app/core/sign-in.ts', old: 'store?.removeItem(SIGN_IN_INTENT_KEY);', new: 'void SIGN_IN_INTENT_KEY;', specs: ['src/app/core/sign-in.spec.ts', DESIGNER] },
    { id: 'S5', name: 'marker never expires', file: 'src/app/core/sign-in.ts', old: 'if (age < 0 || age >= SIGN_IN_INTENT_MAX_AGE_MS) return null;', new: 'if (age < 0) return null;', specs: ['src/app/core/sign-in.spec.ts'] },
    { id: 'A40', name: 'signed-out Save writes (Boo A40 negative control)', file: 'src/app/shared/save-bar/save-bar.ts', old: 'this.signIn.emit();', new: "this.save.emit('save');", specs: ['src/app/shared/sign-in/sign-in.spec.ts', DESIGNER] },
    { id: 'R1', name: 'refresh while signed out', file: 'src/app/core/save-session.ts', old: 'if (!session.isAuthenticated() || restored === null || this.deps.source() !== restored) {', new: 'if (restored === null || this.deps.source() !== restored) {', specs: [DESIGNER, SHOW] },
    { id: 'R2', name: 'refresh after a /c/ handoff', file: 'src/app/core/save-session.ts', old: 'if (!session.isAuthenticated() || restored === null || this.deps.source() !== restored) {', new: 'if (!session.isAuthenticated() || restored === null) {', specs: [DESIGNER, SHOW] },
    { id: 'R3', name: 'refresh adopts updatedAt (defeats If-Match)', file: 'src/app/core/creation-save.ts', old: 'isOwner: r.isOwner === true,', new: 'isOwner: r.isOwner === true, updatedAt: r.updatedAt,', specs: [SAVE, DESIGNER, SHOW] },
    { id: 'R4', name: 'return toast without a session', file: 'src/app/core/save-session.ts', old: 'if (intent && session.isAuthenticated()) {', new: 'if (intent) {', specs: [DESIGNER] },
    { id: 'I1', name: 'PUT without If-Match', file: 'src/app/core/creations.ts', old: "new HttpHeaders({ 'If-Match': ifMatchTag(updatedAt) }),", new: 'new HttpHeaders(),', specs: ['src/app/core/creations.spec.ts', SAVE, DESIGNER, SHOW] },
    { id: 'I2', name: 'empty token sends a PUT', file: 'src/app/core/creation-save.ts', old: "if (plan.request === 'update' && plan.updatedAt === '') {", new: "if (plan.request === 'update' && plan.updatedAt === 'never') {", specs: [SAVE] },
    { id: 'P1', name: 'Replace sends a blind *', file: 'src/app/core/creation-save.ts', old: "updatedAt: current.updatedAt ?? '' };", new: "updatedAt: '*' };", specs: [SAVE, DESIGNER, SHOW] },
    { id: 'P2', name: 'Replace ignores isOwner', file: 'src/app/core/creation-save.ts', old: 'if (current?.isOwner !== true || current.kind !== kind) {', new: 'if (current.kind !== kind) {', specs: [SAVE, DESIGNER] },
    { id: 'U1', name: '401 does not reload the session', file: 'src/app/core/auth-interceptor.ts', old: 'session.load().subscribe();', new: 'void session;', specs: ['src/app/core/auth-interceptor.spec.ts', DESIGNER, SHOW, 'src/app/features/mine/pages/mine-page/mine-page.spec.ts'] },
    { id: 'L1', name: 'Remixed from without a session (A43)', file: 'src/app/features/player/pages/player-page/player-page.ts', old: 'if (!this.session.isAuthenticated() || opened.response.isOwner !== true) return null;', new: 'if (opened.response.isOwner !== true) return null;', specs: ['src/app/features/player/pages/player-page/player-page.spec.ts'] },
    { id: 'L2', name: 'Remixed from without the pattern (C4)', file: 'src/app/features/player/pages/player-page/player-page.ts', old: "return typeof code === 'string' && isShareCode(code) ? { code } : null;", new: "return typeof code === 'string' && code.length > 0 ? { code } : null;", specs: ['src/app/features/player/pages/player-page/player-page.spec.ts'] },
    { id: 'G2', name: 'Sign out clears the show draft (Mario G2)', swaps: [
      { file: 'src/app/shared/sign-in/account-control.ts', old: "import { NotificationService } from '../../core/notifications';", new: "import { NotificationService } from '../../core/notifications';\nimport { BROWSER_STORAGE } from '../../core/browser';" },
      { file: 'src/app/shared/sign-in/account-control.ts', old: '      this.signedOut.emit();', new: "      this.signedOut.emit();\n      this.injector.get(BROWSER_STORAGE)?.removeItem('fireworks.showDraft.v1');" },
    ], specs: [DESIGNER] },
    { id: 'M1', name: '/mine lists while signed out (A44 page rule)', file: 'src/app/features/mine/pages/mine-page/mine-page.ts', old: "const ready = this.session.status() === 'ready' && this.session.canWrite();", new: "const ready = this.session.status() === 'ready';", specs: ['src/app/features/mine/pages/mine-page/mine-page.spec.ts'] },
  ],
};

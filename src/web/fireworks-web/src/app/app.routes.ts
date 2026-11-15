import { Routes, UrlMatcher, UrlSegment } from '@angular/router';

/**
 * Every page is lazy. pixi.js is in neither the initial bundle nor any page chunk: the fireworks
 * stage loads engine/render/pixi-renderer through its own dynamic import (STAGE_RENDERER_FACTORY),
 * so Pixi is a separate lazy chunk fetched only when a stage mounts.
 *
 * `/` is the Shell Designer (OQ8). `/status` is the Phase 1 status page, moved there in 2c with no
 * stage (decided 2026-11-12). Phase 5 (schema.md §11.1): `/s/:shareCode` is the player,
 * `/c/:shareCode` opens a working copy and redirects to `/` (a shell) or `/show` (a show, Phase 6),
 * `/show` is the Show Builder (phase-6.md §2), `/mine` is My creations. Any other
 * path under `/s` or `/c` gets the link not-found page (Peach N3); other unknown paths go to the
 * designer.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/designer/pages/designer-page/designer-page').then(
        (m) => m.DesignerPageComponent,
      ),
  },
  {
    path: 'show',
    loadComponent: () =>
      import('./features/show/pages/show-builder-page/show-builder-page').then(
        (m) => m.ShowBuilderPageComponent,
      ),
  },
  {
    path: 'status',
    loadComponent: () => import('./pages/status/status-page').then((m) => m.StatusPageComponent),
  },
  {
    path: 's/:shareCode',
    loadComponent: () =>
      import('./features/player/pages/player-page/player-page').then((m) => m.PlayerPageComponent),
  },
  {
    path: 'c/:shareCode',
    loadComponent: () =>
      import('./features/designer/pages/open-link-page/open-link-page').then(
        (m) => m.OpenLinkPageComponent,
      ),
  },
  {
    path: 'mine',
    loadComponent: () =>
      import('./features/mine/pages/mine-page/mine-page').then((m) => m.MinePageComponent),
  },
  {
    matcher: underPrefix('s'),
    data: { surface: 'player' },
    loadComponent: linkNotFound,
  },
  {
    matcher: underPrefix('c'),
    data: { surface: 'copy' },
    loadComponent: linkNotFound,
  },
  { path: '**', redirectTo: '' },
];

function linkNotFound() {
  return import('./pages/link-not-found/link-not-found-page').then(
    (m) => m.LinkNotFoundPageComponent,
  );
}

/** Matches `/{prefix}` and anything under it (after the `:shareCode` route had its chance). */
export function underPrefix(prefix: string): UrlMatcher {
  return (segments: UrlSegment[]) => (segments[0]?.path === prefix ? { consumed: segments } : null);
}

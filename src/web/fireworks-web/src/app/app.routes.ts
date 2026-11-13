import { Routes } from '@angular/router';

/**
 * Every page is lazy. pixi.js is in neither the initial bundle nor any page chunk: the fireworks
 * stage loads engine/render/pixi-renderer through its own dynamic import (STAGE_RENDERER_FACTORY),
 * so Pixi is a separate lazy chunk fetched only when a stage mounts.
 *
 * `/` is the Shell Designer (OQ8). `/status` is the Phase 1 status page, moved there in 2c with no
 * stage (decided 2026-11-12). Unknown paths go to the designer.
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
    path: 'status',
    loadComponent: () => import('./pages/status/status-page').then((m) => m.StatusPageComponent),
  },
  { path: '**', redirectTo: '' },
];

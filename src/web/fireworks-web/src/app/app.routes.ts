import { Routes } from '@angular/router';

/**
 * Every page is lazy. pixi.js is in neither the initial bundle nor the home chunk: the home page's
 * canary loads it through its own dynamic import (CANARY_SCENE_FACTORY), so it is a separate lazy
 * chunk fetched only when the canary mounts (checked from the build stats in Phase 1).
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePageComponent),
  },
  { path: '**', redirectTo: '' },
];

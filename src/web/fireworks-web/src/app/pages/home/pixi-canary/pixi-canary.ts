import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { CanaryHandle, CanaryRenderer } from './canary-scene';

export type CanaryStatus = 'starting' | 'running' | 'failed';

/** Visible names for the renderer Pixi picked. Only `webgl` proves WebGL. */
export const CANARY_RENDERER_LABELS: Readonly<Record<CanaryRenderer, string>> = {
  webgl: 'WebGL',
  webgpu: 'WebGPU (WebGL unavailable, Pixi fell back)',
  canvas: 'Canvas 2D (WebGL unavailable, Pixi fell back)',
};

/**
 * Starts the canary scene. The default dynamically imports canary-scene.ts, so pixi.js is only
 * fetched when a canary actually mounts (its own lazy chunk), and specs can swap in a fake
 * without jsdom ever loading Pixi or needing WebGL.
 */
export const CANARY_SCENE_FACTORY = new InjectionToken<() => Promise<CanaryHandle>>(
  'CANARY_SCENE_FACTORY',
  {
    providedIn: 'root',
    factory: () => () => import('./canary-scene').then((m) => m.startCanaryScene()),
  },
);

/**
 * Hosts the Phase 1 Pixi canary. Lifecycle rules this follows (and app-fireworks-stage will too):
 *  - Pixi starts in `afterNextRender`, never in the constructor, so it only runs in a browser
 *    with the host element in the DOM.
 *  - Destroy can arrive while `app.init()` is still pending. Destroying a half-initialized Pixi
 *    Application throws, so the component records that it was destroyed and tears the scene down
 *    the moment init resolves instead.
 *  - Teardown runs from DestroyRef and releases the WebGL context.
 *  - It reports the renderer Pixi actually picked (`data-renderer` and visible text), because
 *    Pixi's WebGL preference falls back silently and "running" alone does not prove WebGL.
 */
@Component({
  selector: 'app-pixi-canary',
  templateUrl: './pixi-canary.html',
  styleUrl: './pixi-canary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PixiCanaryComponent {
  private readonly startScene = inject(CANARY_SCENE_FACTORY);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly status = signal<CanaryStatus>('starting');
  readonly renderer = signal<CanaryRenderer | null>(null);
  readonly rendererLabel = computed(() => {
    const renderer = this.renderer();
    return renderer ? (CANARY_RENDERER_LABELS[renderer] ?? renderer) : null;
  });
  readonly ariaLabel = computed(() => {
    const label = this.rendererLabel();
    return `Pixi canary: a few glowing dots${label ? ` rendered with ${label}` : ''}`;
  });

  private handle: CanaryHandle | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.start();
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.handle?.destroy();
      this.handle = null;
    });
  }

  private async start(): Promise<void> {
    let handle: CanaryHandle;
    try {
      handle = await this.startScene();
    } catch (error) {
      console.error('Pixi canary failed to start', error);
      if (!this.destroyed) {
        this.status.set('failed');
      }
      return;
    }

    if (this.destroyed) {
      handle.destroy();
      return;
    }

    this.handle = handle;
    this.host().nativeElement.appendChild(handle.canvas);
    this.renderer.set(handle.renderer);
    this.status.set('running');
  }
}

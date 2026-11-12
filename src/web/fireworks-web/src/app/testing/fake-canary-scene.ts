import type { CanaryHandle, CanaryRenderer } from '../pages/home/pixi-canary/canary-scene';

/**
 * Stands in for the Pixi canary scene in specs: jsdom has no WebGL, and the real factory's
 * dynamic import would pull pixi.js into the test bundle. Each `start()` returns a promise the
 * spec resolves or rejects by hand, so destroy-before-init can be exercised deterministically.
 */
export class FakeCanaryScene {
  readonly starts: {
    resolve: (renderer?: CanaryRenderer) => FakeHandle;
    reject: (error: unknown) => void;
  }[] = [];
  readonly handles: FakeHandle[] = [];

  readonly factory = (): Promise<CanaryHandle> =>
    new Promise<CanaryHandle>((resolve, reject) => {
      this.starts.push({
        resolve: (renderer: CanaryRenderer = 'webgl') => {
          const handle = new FakeHandle(renderer);
          this.handles.push(handle);
          resolve(handle);
          return handle;
        },
        reject,
      });
    });
}

export class FakeHandle implements CanaryHandle {
  readonly canvas = document.createElement('canvas');
  destroyCalls = 0;

  constructor(readonly renderer: CanaryRenderer = 'webgl') {}

  destroy(): void {
    this.destroyCalls++;
    this.canvas.remove();
  }
}

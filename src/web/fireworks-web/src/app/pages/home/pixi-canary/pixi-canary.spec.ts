import { TestBed } from '@angular/core/testing';
import { FakeCanaryScene } from '../../../testing/fake-canary-scene';
import { CANARY_SCENE_FACTORY, PixiCanaryComponent } from './pixi-canary';

/** Lets pending promise callbacks (the component's `await`) run. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('PixiCanaryComponent', () => {
  let scene: FakeCanaryScene;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    scene = new FakeCanaryScene();
    TestBed.configureTestingModule({
      imports: [PixiCanaryComponent],
      providers: [{ provide: CANARY_SCENE_FACTORY, useValue: scene.factory }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('starts the scene once after render and mounts its canvas', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();
    expect(scene.starts.length).toBe(1);
    expect(fixture.componentInstance.status()).toBe('starting');

    const handle = scene.starts[0].resolve();
    await flushMicrotasks();
    await fixture.whenStable();

    const host = (fixture.nativeElement as HTMLElement).querySelector('.canary')!;
    expect(host.contains(handle.canvas)).toBe(true);
    expect(host.getAttribute('data-status')).toBe('running');

    // Further change detection never starts a second stage.
    fixture.detectChanges();
    await fixture.whenStable();
    expect(scene.starts.length).toBe(1);
  });

  it('destroys the scene exactly once on component destroy, removing the canvas', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();
    const handle = scene.starts[0].resolve();
    await flushMicrotasks();

    fixture.destroy();

    expect(handle.destroyCalls).toBe(1);
    expect(handle.canvas.isConnected).toBe(false);
  });

  it('destroyed while init is pending: tears the scene down when init resolves, never mounts it', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector('.canary')!;

    fixture.destroy();
    const handle = scene.starts[0].resolve();
    await flushMicrotasks();

    expect(handle.destroyCalls).toBe(1);
    expect(host.contains(handle.canvas)).toBe(false);
  });

  it('destroyed before first render: never starts a scene', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    fixture.destroy();
    await flushMicrotasks();

    expect(scene.starts.length).toBe(0);
  });

  it('reports WebGL in data-renderer and the visible text when Pixi got WebGL', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.canary')!.hasAttribute('data-renderer')).toBe(false);
    expect(el.querySelector('[data-testid="canary-renderer"]')).toBeNull();

    scene.starts[0].resolve('webgl');
    await flushMicrotasks();
    await fixture.whenStable();

    expect(el.querySelector('.canary')!.getAttribute('data-renderer')).toBe('webgl');
    expect(el.querySelector('[data-testid="canary-renderer"]')!.textContent!.trim()).toBe(
      'Renderer: WebGL',
    );
  });

  it.each([
    ['webgpu', 'Renderer: WebGPU (WebGL unavailable, Pixi fell back)'],
    ['canvas', 'Renderer: Canvas 2D (WebGL unavailable, Pixi fell back)'],
  ] as const)('says so when Pixi fell back to %s, while still running', async (renderer, text) => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();

    scene.starts[0].resolve(renderer);
    await flushMicrotasks();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const host = el.querySelector('.canary')!;
    expect(host.getAttribute('data-status')).toBe('running');
    expect(host.getAttribute('data-renderer')).toBe(renderer);
    expect(host.getAttribute('aria-label')).not.toContain('rendered with WebGL');
    expect(el.querySelector('[data-testid="canary-renderer"]')!.textContent!.trim()).toBe(text);
  });

  it('shows the start-failure message, with no renderer claimed, when the scene fails', async () => {
    const fixture = TestBed.createComponent(PixiCanaryComponent);
    await fixture.whenStable();

    scene.starts[0].reject(new Error('No available renderer for the current environment'));
    await flushMicrotasks();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.status()).toBe('failed');
    expect(el.textContent).toContain('The Pixi canary could not start');
    expect(el.textContent).not.toContain('WebGL is unavailable');
    expect(el.querySelector('.canary')!.hasAttribute('data-renderer')).toBe(false);
    expect(el.querySelector('[data-testid="canary-renderer"]')).toBeNull();
  });

  it('mount/destroy cycles leave no live scenes behind', async () => {
    for (let i = 0; i < 5; i++) {
      const fixture = TestBed.createComponent(PixiCanaryComponent);
      await fixture.whenStable();
      scene.starts[i].resolve();
      await flushMicrotasks();
      fixture.destroy();
    }

    expect(scene.handles.map((h) => h.destroyCalls)).toEqual([1, 1, 1, 1, 1]);
    expect(scene.handles.some((h) => h.canvas.isConnected)).toBe(false);
  });
});

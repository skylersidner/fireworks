import { TestBed } from '@angular/core/testing';
import { DEVICE_PIXEL_RATIO, MATCH_MEDIA, canvasResolution } from '../../../../core/browser';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { ShowTimelineComponent } from './timeline';

/** phase-7.md §5.1 (R2) and §11, acceptance 7f.2 and 7e.11, on the timeline's 2D canvases. */
describe('ShowTimelineComponent canvas resolution and context restore', () => {
  let media: FakeMatchMedia;
  let dpr: number;

  beforeEach(() => {
    media = new FakeMatchMedia();
    dpr = 2;
    TestBed.configureTestingModule({
      imports: [ShowTimelineComponent],
      providers: [
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: DEVICE_PIXEL_RATIO, useValue: () => dpr },
      ],
    });
  });

  async function drawn(width = 400, height = 160) {
    const fixture = TestBed.createComponent(ShowTimelineComponent);
    await fixture.whenStable();
    const c = fixture.componentInstance as unknown as {
      size: { set(v: { w: number; h: number }): void };
      draw(): void;
      schedule(): void;
    };
    c.size.set({ w: width, h: height });
    c.draw();
    const el = fixture.nativeElement as HTMLElement;
    const ruler = el.querySelector<HTMLCanvasElement>('[data-testid="timeline-ruler"]')!;
    const lane = el.querySelector<HTMLCanvasElement>('[data-testid="timeline-lane"]')!;
    return { fixture, c, ruler, lane };
  }

  const cases: [boolean, number, number][] = [
    [true, 3, 1.5],
    [false, 2, 2],
    [false, 3, 2], // the timeline used the raw ratio (3) before Phase 7
    [true, 1, 1],
  ];
  for (const [coarse, ratio, expected] of cases) {
    it(`${coarse ? 'coarse' : 'fine'} at DPR ${ratio}: ruler and lane backing stores at ${expected}x`, async () => {
      media.set('(pointer: coarse)', coarse);
      dpr = ratio;
      const { ruler, lane } = await drawn(400, 160);
      expect(ruler.width).toBe(Math.round(400 * expected));
      expect(lane.width).toBe(Math.round(400 * expected));
      expect(ruler.style.width).toBe('400px');
    });
  }

  it('the shared rule: min(dpr, coarse ? 1.5 : 2), and a bad ratio reads as 1', () => {
    expect(canvasResolution(3, true)).toBe(1.5);
    expect(canvasResolution(1.25, true)).toBe(1.25);
    expect(canvasResolution(3, false)).toBe(2);
    expect(canvasResolution(0, false)).toBe(1);
    expect(canvasResolution(Number.NaN, true)).toBe(1);
  });

  it('a contextrestored on either canvas schedules a redraw; nothing after destroy', async () => {
    const { fixture, c, ruler, lane } = await drawn();
    const schedule = vi.spyOn(c, 'schedule');
    ruler.dispatchEvent(new Event('contextrestored'));
    lane.dispatchEvent(new Event('contextrestored'));
    expect(schedule).toHaveBeenCalledTimes(2);
    fixture.destroy();
    ruler.dispatchEvent(new Event('contextrestored'));
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});

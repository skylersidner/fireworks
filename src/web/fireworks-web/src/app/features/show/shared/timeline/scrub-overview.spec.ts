import { TestBed } from '@angular/core/testing';
import { DEVICE_PIXEL_RATIO, MATCH_MEDIA } from '../../../../core/browser';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { OVERVIEW_HEIGHT, ScrubOverviewComponent } from './scrub-overview';

/** phase-7.md §5.1, §7.3; acceptance 7f.2 (overview), 7j.13. */
describe('ScrubOverviewComponent', () => {
  let media: FakeMatchMedia;
  let dpr: number;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    media = new FakeMatchMedia();
    dpr = 3;
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    TestBed.configureTestingModule({
      imports: [ScrubOverviewComponent],
      providers: [
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: DEVICE_PIXEL_RATIO, useValue: () => dpr },
      ],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const flush = () => {
    const due = frames.splice(0);
    for (const cb of due) cb(0);
  };

  async function make() {
    const fixture = TestBed.createComponent(ScrubOverviewComponent);
    fixture.componentRef.setInput('show', doneWhenShow());
    fixture.componentRef.setInput('viewEnd', 70);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    (c as unknown as { width: { set(v: number): void } }).width.set(300);
    await fixture.whenStable();
    flush();
    const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
    return { fixture, c, canvas };
  }

  it('an aria-hidden canvas, 12 px tall, behind the range', async () => {
    const { canvas } = await make();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.height).toBe(`${OVERVIEW_HEIGHT}px`);
    expect(OVERVIEW_HEIGHT).toBe(12);
  });

  for (const [coarse, ratio, expected] of [
    [true, 3, 1.5],
    [false, 2, 2],
    [false, 3, 2],
  ] as const) {
    it(`${coarse ? 'coarse' : 'fine'} at DPR ${ratio}: backing store at ${expected}x (7f.2)`, async () => {
      media.set('(pointer: coarse)', coarse);
      dpr = ratio;
      const { canvas } = await make();
      expect(canvas.width).toBe(Math.round(300 * expected));
      expect(canvas.height).toBe(Math.round(OVERVIEW_HEIGHT * expected));
    });
  }

  it('redraws on a document, selection or view change, and not otherwise (never per frame)', async () => {
    const { fixture, c } = await make();
    const base = c.draws;
    expect(base).toBeGreaterThan(0);
    // "Playing for 2 s": change detection and frames with no input change add no draw.
    for (let k = 0; k < 120; k++) {
      fixture.detectChanges();
      flush();
    }
    expect(c.draws).toBe(base);
    fixture.componentRef.setInput('selectedId', 'c3');
    await fixture.whenStable();
    flush();
    expect(c.draws).toBe(base + 1);
    fixture.componentRef.setInput('window', { start: 10, end: 20, atFit: false });
    fixture.componentRef.setInput('end', 66);
    await fixture.whenStable();
    flush();
    expect(c.draws).toBe(base + 2); // two changes in one frame: one draw
  });
});

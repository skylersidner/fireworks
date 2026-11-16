import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { DEFAULT_QUALITY, type ShellDocument } from '../../../../../engine/model/shell';
import { PRESETS } from '../../../../../engine/model/presets';
import {
  embeddedShell,
  STEPS_PER_SECOND,
  type ShowDocument,
} from '../../../../../engine/model/show';
import { estimateShowEnd } from '../../../../../engine/sim/lifetime';
import { REDUCED_MOTION_QUERY, mediaQuery } from '../../../../core/browser';
import { ClientConfigStore, checkpointOptions } from '../../../../core/client-config';
import { CreationsService } from '../../../../core/creations';
import { DevicePreferencesService } from '../../../../core/device-preferences';
import { openCreation, type OpenedCreation } from '../../../../core/open-creation';
import { isShareCode } from '../../../../core/share-code';
import {
  FireworksStageComponent,
  type TimelineFrameHook,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  SITE_TITLE,
  creationTitle,
  invalidMessage,
  loadFailureMessage,
  newerVersionMessage,
  notFoundMessage,
  retryWhen,
  type LinkAction,
  type LinkMessage,
} from '../../../../shared/link-copy';
import { MessagePageComponent } from '../../../../shared/message-page/message-page';
import { StaticSkylineComponent } from '../../../../shared/static-skyline';
import { TestModeBannerComponent } from '../../../../shared/test-mode-banner';
import { PlayerNoticeComponent } from '../../shared/player-notice';
import { announcement } from '../../../../shared/announcer';

/** The `Loading…` line waits this long (phase-5.md §8.4). */
export const LOADING_DELAY_MS = 300;

/** The line under the centered Play (phase-5.md §8.2, S1), by the Reduce flashing setting. */
export const CENTER_LINE_REDUCED = 'Reduce flashing is on. Press Play to start.';
export const CENTER_LINE = 'Press Play to start.';

/** Where Space already means something (designer-2c.md §6.2's list). */
const SPACE_OWNERS =
  'input, textarea, select, button, a[href], summary, dialog, [contenteditable]:not([contenteditable="false"]), [role="tab"], [role="switch"], [role="button"], [role="checkbox"], [role="slider"]';

/** The polite announcement at a show's end (phase-6.md §11.2). */
export const SHOW_ENDED_ANNOUNCEMENT = 'The show has ended.';

/** `{length}` (phase-6.md §11.3): under 60 s in seconds, else whole minutes; always "about". */
export function showLengthText(seconds: number): string {
  if (seconds < 60) {
    const n = Math.max(1, Math.round(seconds));
    return `${n} ${n === 1 ? 'second' : 'seconds'}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

/** `m:ss`, whole seconds (the meta line). */
function clock(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  return `${m}:${String(total - m * 60).padStart(2, '0')}`;
}

interface PlayingShow {
  readonly show: ShowDocument;
  readonly shareCode: string;
  readonly name: string;
  readonly strobe: boolean;
  readonly estimate: number;
  readonly length: string;
}

interface Playing {
  readonly shell: ShellDocument;
  readonly shareCode: string;
  readonly name: string;
  readonly strobe: boolean;
}

/**
 * The player at `/s/:shareCode` (plan Phase 5; phase-5.md §8): full screen, lazy, a viewer. It
 * fetches, checks `kind`, upgrades and normalizes (`openCreation`, Boo C5), then plays the shell
 * as the designer's Preview loop. The stage mounts only once there is a shell to play, so a 404
 * fetches no Pixi chunk.
 *
 *  - Flashing safety before the first burst (Boo C19): the device-wide notice holds playback until
 *    it's answered, and under `prefers-reduced-motion` the player opens paused (never remembered).
 *  - Remix always shows (Skyler, 2026-11-14): it navigates to `/c/{code}` and writes nothing. No
 *    Save here, and no "Remixed from" anywhere (Boo C10).
 *  - It never reads or writes the designer draft (acceptance 5f.7). Reduce flashing is the
 *    device-wide choice (core/device-preferences.ts).
 */
@Component({
  selector: 'app-player-page',
  imports: [
    FireworksStageComponent,
    MessagePageComponent,
    PlayerNoticeComponent,
    RouterLink,
    StaticSkylineComponent,
    TestModeBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-dvh',
    '(document:keydown)': 'onKeydown($event)',
  },
  templateUrl: './player-page.html',
})
export class PlayerPageComponent {
  private readonly creations = inject(CreationsService);
  private readonly prefs = inject(DevicePreferencesService);
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The route's `:shareCode`, checked against the §9 pattern before any request (Boo C4). */
  private code = '';

  protected readonly stage = viewChild(FireworksStageComponent);
  private readonly reducedMotion = mediaQuery(REDUCED_MOTION_QUERY);

  private readonly opened = signal<OpenedCreation | null>(null);
  protected readonly showLoading = signal(false);
  protected readonly playing = computed<Playing | null>(() => {
    const opened = this.opened();
    if (opened?.status !== 'shell') return null;
    const shell = opened.shell;
    return {
      shell,
      shareCode: opened.response.shareCode,
      // The normalized document's name, not the envelope's (Boo C5).
      name: shell.name,
      strobe: shell.breaks.some((b) => b.effect === 'strobe'),
    };
  });
  /** A show (Phase 6): played once with TimelineDriver at `starBudget` 1 (phase-6.md §11.2). */
  protected readonly playingShow = computed<PlayingShow | null>(() => {
    const opened = this.opened();
    if (opened?.status !== 'show') return null;
    const show = opened.show;
    const used = new Set(show.cues.map((c) => c.shell));
    const estimate = estimateShowEnd(show);
    return {
      show,
      shareCode: opened.response.shareCode,
      name: show.name,
      // Only shells a cue uses ever play, so only they can strobe (§11.3).
      strobe: [...used].some((k) =>
        embeddedShell(show, k)?.breaks.some((b) => b.effect === 'strobe'),
      ),
      estimate,
      length: showLengthText(estimate),
    };
  });
  protected readonly driver = computed(() => {
    const p = this.playingShow();
    // Checkpoint settings from ClientConfigStore, untracked (applied when a show opens).
    return p
      ? new TimelineDriver(p.show, checkpointOptions(untracked(this.clientConfig.playback)))
      : null;
  });
  protected readonly placeholderShell = PRESETS[0];
  /** At the end step (§11.2): the ended state with Replay. */
  protected readonly ended = signal(false);
  /** Repeats re-announce (phase-7.md §10 B4). */
  protected readonly announcement = announcement();
  private readonly metaTime = viewChild<ElementRef<HTMLElement>>('metaTime');
  private readonly progress = viewChild<ElementRef<HTMLElement>>('progress');
  private lastSecond = -1;
  private exactEnd: number | null = null;
  /** Per frame, outside change detection: the meta time and progress line through element refs. */
  protected readonly frameHook: TimelineFrameHook = (step, driver) => {
    const p = untracked(this.playingShow);
    if (!p) return;
    if (driver.endStep !== null) this.exactEnd = driver.endStep / STEPS_PER_SECOND;
    const t = step / STEPS_PER_SECOND;
    const end = this.exactEnd ?? Math.max(p.estimate, t);
    const bar = this.progress()?.nativeElement;
    if (bar) bar.style.transform = `scaleX(${end > 0 ? Math.min(1, t / end) : 0})`;
    // Refresh on a new second, and once when the exact end becomes known (§11.1 "/ 1:07").
    const second = Math.floor(t) * 2 + (this.exactEnd === null ? 0 : 1);
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      const el = this.metaTime()?.nativeElement;
      if (el) el.textContent = this.metaText(t, p);
    }
  };

  protected readonly message = computed<LinkMessage | null>(() => {
    const opened = this.opened();
    return opened && opened.status !== 'shell' && opened.status !== 'show'
      ? messageFor(opened)
      : null;
  });

  /** Shown until answered on this device (shared with the designer). */
  protected readonly noticeVisible = signal(!this.prefs.flashNoticeDismissed());
  /** Under reduced motion the player opens paused, every load (§8.2). */
  protected readonly userPaused = signal(untracked(this.reducedMotion));
  protected readonly paused = computed(() => this.noticeVisible() || this.userPaused());
  /** The centered Play on the empty sky: reduced motion, notice answered, not yet started. */
  protected readonly showCenterPlay = signal(untracked(this.reducedMotion));

  protected readonly reduceFlashing = computed(
    () => this.prefs.reduceFlashingChoice() ?? this.reducedMotion(),
  );
  protected readonly centerLine = computed(() =>
    this.reduceFlashing() ? CENTER_LINE_REDUCED : CENTER_LINE,
  );
  /** Motion blur is this device's (shared with the designer and the builder; Skyler, 2026-11-14). */
  protected readonly quality = computed(() => ({
    ...DEFAULT_QUALITY,
    persistence: this.prefs.motionBlur(),
    reduceFlashing: this.reduceFlashing(),
  }));

  private request: Subscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      if (this.timer) clearTimeout(this.timer);
    });
    // The component is reused when only the code changes (`/c/a` → `/c/b`), so follow the param.
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.code = params.get('shareCode') ?? '';
        this.load();
      });
  }

  protected metaClock(t: number): string {
    return clock(t);
  }

  protected metaText(t: number, p: PlayingShow): string {
    return this.exactEnd !== null
      ? `${clock(t)} / ${clock(this.exactEnd)}`
      : `${clock(t)} / about ${clock(p.estimate)}`;
  }

  protected onShowEnded(): void {
    this.ended.set(true);
    this.userPaused.set(true);
    this.announcement.set(SHOW_ENDED_ANNOUNCEMENT);
  }

  protected remix(): void {
    const code = this.playing()?.shareCode ?? this.playingShow()?.shareCode;
    if (!code || !isShareCode(code)) return;
    void this.router.navigate(['/c', code]);
  }

  protected togglePause(): void {
    if (this.noticeVisible()) return;
    if (this.ended()) {
      this.replay();
      return;
    }
    this.showCenterPlay.set(false);
    this.userPaused.update((p) => !p);
  }

  protected startFromCenter(): void {
    this.showCenterPlay.set(false);
    this.userPaused.set(false);
    this.focusTestId('player-pause');
  }

  protected replay(): void {
    if (this.playingShow()) {
      if (this.noticeVisible()) return;
      // From step 0 again, the same ledger (§11.2, Peach 6h.4).
      this.stage()?.seek(0);
      this.ended.set(false);
      this.announcement.set('');
      this.showCenterPlay.set(false);
      this.userPaused.set(false);
      this.lastSecond = -1;
      this.focusTestId('player-pause');
      return;
    }
    const playing = this.playing();
    if (!playing || this.paused()) return;
    this.stage()?.fireNow(playing.shell);
  }

  protected setReduceFlashing(on: boolean): void {
    this.prefs.setReduceFlashing(on);
  }

  /**
   * Either notice button. The visitor answered a notice that said playback starts, so this is the
   * explicit start the reduced-motion rule waits for (§8.3). Reduce flashing is set first, so the
   * first burst is already reduced.
   */
  protected answerNotice(turnOnReduceFlashing: boolean): void {
    if (turnOnReduceFlashing) this.prefs.setReduceFlashing(true);
    this.prefs.dismissFlashNotice();
    this.noticeVisible.set(false);
    this.userPaused.set(false);
    this.showCenterPlay.set(false);
    this.focusTestId('player-pause');
  }

  protected act(action: LinkAction): void {
    if (action === 'retry') this.load();
    else if (action === 'reload') location.reload();
    else void this.router.navigateByUrl('/');
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((!this.playing() && !this.playingShow()) || this.noticeVisible()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(SPACE_OWNERS)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.togglePause();
  }

  private load(): void {
    this.opened.set(null);
    this.ended.set(false);
    this.exactEnd = null;
    this.lastSecond = -1;
    this.showLoading.set(false);
    this.title.setTitle(SITE_TITLE);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.showLoading.set(true), LOADING_DELAY_MS);
    this.request?.unsubscribe();
    this.request = openCreation(this.creations, this.code).subscribe((opened) => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.showLoading.set(false);
      this.opened.set(opened);
      this.title.setTitle(
        opened.status === 'shell'
          ? creationTitle(opened.shell.name)
          : opened.status === 'show'
            ? creationTitle(opened.show.name)
            : messageFor(opened).title,
      );
      const plays = opened.status === 'shell' || opened.status === 'show';
      if (plays && !this.noticeVisible() && this.showCenterPlay()) {
        this.focusTestId('player-center-play');
      }
    });
  }

  private focusTestId(id: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}

function messageFor(opened: OpenedCreation): LinkMessage {
  switch (opened.status) {
    case 'not-found':
      return notFoundMessage('player');
    case 'newer':
      return newerVersionMessage('player');
    case 'network':
      return loadFailureMessage('player', 'network', '');
    case 'rate-limited':
      return loadFailureMessage('player', 'rate-limited', retryWhen(opened.retryAfterSeconds));
    case 'server':
      return loadFailureMessage('player', 'server', '');
    default:
      return invalidMessage('player');
  }
}

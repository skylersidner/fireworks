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
import { DEFAULT_QUALITY, type ShellDocument } from '../../../../../engine/model/shell';
import { REDUCED_MOTION_QUERY, mediaQuery } from '../../../../core/browser';
import { CreationsService } from '../../../../core/creations';
import { DevicePreferencesService } from '../../../../core/device-preferences';
import { openCreation, type OpenedCreation } from '../../../../core/open-creation';
import { isShareCode } from '../../../../core/share-code';
import { FireworksStageComponent } from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  SITE_TITLE,
  creationTitle,
  invalidMessage,
  loadFailureMessage,
  newerVersionMessage,
  notFoundMessage,
  retryWhen,
  showNotSupportedMessage,
  type LinkAction,
  type LinkMessage,
} from '../../../../shared/link-copy';
import { MessagePageComponent } from '../../../../shared/message-page/message-page';
import { StaticSkylineComponent } from '../../../../shared/static-skyline';
import { TestModeBannerComponent } from '../../../../shared/test-mode-banner';
import { PlayerNoticeComponent } from '../../shared/player-notice';

/** The `Loading…` line waits this long (phase-5.md §8.4). */
export const LOADING_DELAY_MS = 300;

/** The line under the centered Play (phase-5.md §8.2, S1), by the Reduce flashing setting. */
export const CENTER_LINE_REDUCED = 'Reduce flashing is on. Press Play to start.';
export const CENTER_LINE = 'Press Play to start.';

/** Where Space already means something (designer-2c.md §6.2's list). */
const SPACE_OWNERS =
  'input, textarea, select, button, a[href], summary, dialog, [contenteditable]:not([contenteditable="false"]), [role="tab"], [role="switch"], [role="button"], [role="checkbox"], [role="slider"]';

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
  protected readonly message = computed<LinkMessage | null>(() => {
    const opened = this.opened();
    return opened && opened.status !== 'shell' ? messageFor(opened) : null;
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
  protected readonly quality = computed(() => ({
    ...DEFAULT_QUALITY,
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

  protected remix(): void {
    const code = this.playing()?.shareCode;
    if (!code || !isShareCode(code)) return;
    void this.router.navigate(['/c', code]);
  }

  protected togglePause(): void {
    if (this.noticeVisible()) return;
    this.showCenterPlay.set(false);
    this.userPaused.update((p) => !p);
  }

  protected startFromCenter(): void {
    this.showCenterPlay.set(false);
    this.userPaused.set(false);
    this.focusTestId('player-pause');
  }

  protected replay(): void {
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
    if (!this.playing() || this.noticeVisible()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(SPACE_OWNERS)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.togglePause();
  }

  private load(): void {
    this.opened.set(null);
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
        opened.status === 'shell' ? creationTitle(opened.shell.name) : messageFor(opened).title,
      );
      if (opened.status === 'shell' && !this.noticeVisible() && this.showCenterPlay()) {
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
    case 'show':
      return showNotSupportedMessage();
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

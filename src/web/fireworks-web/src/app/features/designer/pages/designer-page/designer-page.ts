import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ApiStatusService } from '../../../../core/api-status';
import { COARSE_POINTER_QUERY, mediaQuery } from '../../../../core/browser';
import { ApiBannerComponent } from '../../shared/api-banner/api-banner';
import { BreakFieldsComponent } from '../../shared/break-fields/break-fields';
import { BreakTabsComponent } from '../../shared/break-tabs/break-tabs';
import { ConfirmDialogComponent } from '../../../../shared/confirm-dialog';
import {
  CONFIRM_APPLY_ACTION,
  CONFIRM_APPLY_TITLE,
  CONFIRM_CANCEL_LABEL,
  JSON_NOTE_COPIED,
  confirmApplyBody,
  confirmPresetAction,
  confirmPresetBody,
  confirmPresetTitle,
  copyBlockedNote,
} from '../../shared/designer-copy';
import type { EditableShell } from '../../shared/designer-draft';
import {
  FireworksStageComponent,
  type StageStats,
} from '../../shared/fireworks-stage/fireworks-stage';
import { FlashNoticeComponent } from '../../shared/flash-notice/flash-notice';
import { HudComponent } from '../../shared/hud/hud';
import { JsonPanelComponent } from '../../shared/json-panel/json-panel';
import { PlaybackControlsComponent } from '../../shared/playback-controls/playback-controls';
import { PresetBarComponent } from '../../shared/preset-bar/preset-bar';
import { QualityFieldsComponent } from '../../shared/quality-fields/quality-fields';
import { ShellFieldsComponent } from '../../shared/shell-fields/shell-fields';
import { SkyFieldsComponent } from '../../shared/sky-fields/sky-fields';
import { ShellDesignerStore, type LoadOutcome } from './shell-designer.store';

/** Where Space already means something, so it must not launch (designer-2c.md §6.2, D10). */
const SPACE_OWNERS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  'dialog',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="tab"]',
  '[role="switch"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="slider"]',
].join(',');

/**
 * The Shell Designer at `/` (plan 2c; designer-2c.md). Owns the page store and the one live
 * stage. Presentational children take inputs and emit outputs; only this page talks to the store.
 * Nothing here calls the API or reads identity (acceptance 2c.8): the API banner reads the
 * app-wide probe result.
 */
@Component({
  selector: 'app-designer-page',
  imports: [
    ApiBannerComponent,
    BreakFieldsComponent,
    BreakTabsComponent,
    ConfirmDialogComponent,
    FireworksStageComponent,
    FlashNoticeComponent,
    HudComponent,
    JsonPanelComponent,
    PlaybackControlsComponent,
    PresetBarComponent,
    QualityFieldsComponent,
    ShellFieldsComponent,
    SkyFieldsComponent,
  ],
  providers: [ShellDesignerStore],
  templateUrl: './designer-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
    // Registered by this page and removed with it, never app-wide (§6.2).
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class DesignerPageComponent {
  protected readonly store = inject(ShellDesignerStore);
  private readonly apiStatus = inject(ApiStatusService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly stage = viewChild(FireworksStageComponent);
  protected readonly coarse = mediaQuery(COARSE_POINTER_QUERY);

  /** Set by the stage's throttled `stats` output (about 4 Hz), never per frame. */
  protected readonly stats = signal<StageStats | null>(null);
  private readonly launchedHere = signal(false);
  /** Replay is disabled until something has launched (D7), and while playback is paused. */
  protected readonly canReplay = computed(
    () => this.launchedHere() || (this.stats()?.seed ?? null) !== null,
  );

  /** Shown while unavailable, and while re-checking after that; gone on recovery (§6.3). */
  protected readonly showApiBanner = linkedSignal<string, boolean>({
    source: this.apiStatus.status,
    computation: (status, previous) =>
      status === 'unavailable' || (status === 'checking' && (previous?.value ?? false)),
  });
  protected readonly apiChecking = computed(() => this.apiStatus.status() === 'checking');

  protected readonly activeBreakFields = computed(
    () => this.store.form.breaks[this.store.activeBreak()],
  );

  /** The replace question (§6.4), naming the shell as its Name field shows it. */
  protected readonly dialog = computed(() => {
    const pending = this.store.pendingReplace();
    if (!pending) return null;
    const name = untracked(() => this.store.model().name);
    return pending.kind === 'preset'
      ? {
          title: confirmPresetTitle(pending.name),
          body: confirmPresetBody(name),
          action: confirmPresetAction(pending.name),
        }
      : {
          title: CONFIRM_APPLY_TITLE,
          body: confirmApplyBody(name, pending.hasSky),
          action: CONFIRM_APPLY_ACTION,
        };
  });
  protected readonly cancelLabel = CONFIRM_CANCEL_LABEL;

  private returnFocus: HTMLElement | null = null;

  protected retryApi(): void {
    this.apiStatus.check();
  }

  protected launch(): void {
    if (this.stage()?.launch() != null) this.launchedHere.set(true);
  }

  protected replay(): void {
    this.stage()?.replay();
  }

  protected clear(): void {
    this.stage()?.clear();
  }

  protected loadPreset(index: number): void {
    this.rememberFocus();
    this.fireIfLoaded(this.store.loadPreset(index));
  }

  protected applyJson(): void {
    this.rememberFocus();
    this.fireIfLoaded(this.store.applyJson());
  }

  protected confirmReplace(): void {
    this.fireIfLoaded(this.store.confirmReplace());
    this.restoreFocus();
  }

  protected cancelReplace(): void {
    this.store.cancelReplace();
    this.restoreFocus();
  }

  /**
   * Either notice button. The focused button goes away with the notice, so focus moves to Launch,
   * which the end of the hold has just enabled (§7.2).
   */
  protected dismissNotice(turnOnReduceFlashing: boolean): void {
    this.store.dismissFlashNotice(turnOnReduceFlashing);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-testid="launch"]')?.focus(),
      { injector: this.injector },
    );
  }

  protected onCopied(ok: boolean): void {
    this.store.setNote(ok ? JSON_NOTE_COPIED : copyBlockedNote(isApplePlatform()));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.store.pendingReplace()) return;
    // Held while the flashing notice shows (§6.2, §7.2): ignored, not swallowed.
    if (this.store.playbackPaused()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(SPACE_OWNERS)) return;
    // Space here means Launch; never scroll the panel. Held Space fires once (D10).
    event.preventDefault();
    if (event.repeat) return;
    this.launch();
  }

  /** Prototype `loadShell(s, true)`: fire the loaded shell now and hold the loop timer. */
  private fireIfLoaded(outcome: LoadOutcome): void {
    if (outcome.status !== 'loaded') return;
    this.fire(outcome.shell);
  }

  private fire(shell: EditableShell): void {
    const stage = this.stage();
    if (!stage) return;
    if (stage.fireNow(shell, shell.sky) !== null) this.launchedHere.set(true);
  }

  private rememberFocus(): void {
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private restoreFocus(): void {
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el?.isConnected) queueMicrotask(() => el.focus());
  }
}

function isApplePlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '');
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiStatusService } from '../../../../core/api-status';
import type { SaveChoice } from '../../../../core/creation-save';
import { TestModeBannerComponent } from '../../../../shared/test-mode-banner';
import { COARSE_POINTER_QUERY, mediaQuery } from '../../../../core/browser';
import { ApiBannerComponent } from '../../shared/api-banner/api-banner';
import { BreakFieldsComponent } from '../../shared/break-fields/break-fields';
import { BreakTabsComponent } from '../../shared/break-tabs/break-tabs';
import { ConfirmDialogComponent } from '../../../../shared/confirm-dialog';
import {
  CONFIRM_APPLY_ACTION,
  CONFIRM_APPLY_TITLE,
  CONFIRM_CANCEL_LABEL,
  CONFIRM_LINK_ACTION,
  JSON_NOTE_COPIED,
  confirmApplyBody,
  confirmLinkBody,
  confirmLinkTitle,
  confirmPresetAction,
  confirmPresetBody,
  confirmPresetTitle,
  copyBlockedNote,
} from '../../shared/designer-copy';
import type { EditableShell } from '../../shared/designer-draft';
import {
  FireworksStageComponent,
  type StageStats,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import { FlashNoticeComponent } from '../../shared/flash-notice/flash-notice';
import { HudComponent } from '../../shared/hud/hud';
import { JsonPanelComponent } from '../../shared/json-panel/json-panel';
import { PlaybackControlsComponent } from '../../shared/playback-controls/playback-controls';
import { PresetBarComponent } from '../../shared/preset-bar/preset-bar';
import { QualityFieldsComponent } from '../../shared/quality-fields/quality-fields';
import { ShellFieldsComponent } from '../../shared/shell-fields/shell-fields';
import { SkyFieldsComponent } from '../../shared/sky-fields/sky-fields';
import { SaveBarComponent } from '../../shared/save-bar/save-bar';
import { shareBlockedNote, type SaveStatusAction } from '../../shared/save-copy';
import { SaveStatusComponent } from '../../shared/save-status/save-status';
import { WorkingCopyHandoff } from '../../shared/working-copy-handoff';
import { DesignerSaveFlow } from './designer-save';
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
 * Save and Share go through DesignerSaveFlow (provided here); the page itself makes no HTTP call
 * and reads identity only through it (designer-structure.spec.ts, the Phase 5 form of 2c.8). A
 * working copy handed over by `/c/:code` is opened on construction, asking first over shell or
 * sky changes (phase-5.md §7.2).
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
    RouterLink,
    SaveBarComponent,
    SaveStatusComponent,
    ShellFieldsComponent,
    SkyFieldsComponent,
    TestModeBannerComponent,
  ],
  providers: [ShellDesignerStore, DesignerSaveFlow],
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
  protected readonly saveFlow = inject(DesignerSaveFlow);
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

  /** Shown while the API or `api/me` is unavailable, and while re-checking after that (§6.3). */
  protected readonly showApiBanner = linkedSignal<string, boolean>({
    source: this.apiStatus.bannerStatus,
    computation: (status, previous) =>
      status === 'unavailable' || (status === 'checking' && (previous?.value ?? false)),
  });
  protected readonly apiChecking = computed(() => this.apiStatus.bannerStatus() === 'checking');

  protected readonly activeBreakFields = computed(
    () => this.store.form.breaks[this.store.activeBreak()],
  );

  /** The replace question (§6.4), naming the shell as its Name field shows it. */
  protected readonly dialog = computed(() => {
    const pending = this.store.pendingReplace();
    if (!pending) return null;
    const name = untracked(() => this.store.model().name);
    if (pending.kind === 'link') {
      return {
        title: confirmLinkTitle(pending.copy.shell.name),
        body: confirmLinkBody(name, pending.copy.shell.name),
        action: CONFIRM_LINK_ACTION,
      };
    }
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

  protected readonly blockedNote = shareBlockedNote(isApplePlatform());

  private returnFocus: HTMLElement | null = null;
  /** A link load to fire once the stage is running (phase-5.md §7.2: "fires once like a preset"). */
  private readonly fireWhenRunning = signal<EditableShell | null>(null);
  /** After a link load or its Keep editing, focus goes to the panel h1 (§7.2, §12.1). */
  private focusHeadingAfterDialog = false;

  constructor() {
    const copy = inject(WorkingCopyHandoff).take();
    if (copy) {
      const outcome = this.store.openWorkingCopy(copy);
      if (outcome.status === 'loaded') {
        this.fireWhenRunning.set(outcome.shell);
        this.focusHeading();
      } else {
        this.focusHeadingAfterDialog = true;
      }
    }
    effect(() => {
      const shell = this.fireWhenRunning();
      if (!shell || this.stage()?.status() !== 'running') return;
      untracked(() => {
        this.fireWhenRunning.set(null);
        this.fire(shell);
      });
    });
    // When a save ends with the pressed button disabled (`Saved`), focus moves on (§12.1).
    let wasSaving = false;
    effect(() => {
      const saving = this.saveFlow.saving() !== null;
      if (wasSaving && !saving) {
        afterNextRender(() => this.moveFocusOffDisabled(), { injector: this.injector });
      }
      wasSaving = saving;
    });
  }

  protected save(choice: SaveChoice): void {
    this.saveFlow.save(choice);
  }

  protected async share(): Promise<void> {
    if ((await this.saveFlow.share()) !== 'blocked') return;
    afterNextRender(
      () => {
        const field = this.byTest<HTMLInputElement>('share-link-field');
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  protected onStatusAction(action: SaveStatusAction): void {
    if (action === 'reload') {
      location.reload();
      return;
    }
    if (action === 'retry') {
      this.saveFlow.retry();
      return;
    }
    // 404a: source is null now, so plain Save is the POST (§6); focus back to it (§12.1).
    this.saveFlow.save('save');
    afterNextRender(() => this.byTest('save-save')?.focus(), { injector: this.injector });
  }

  protected retryApi(): void {
    this.apiStatus.retry();
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
    this.afterDialog();
  }

  protected cancelReplace(): void {
    this.store.cancelReplace();
    this.afterDialog();
  }

  private afterDialog(): void {
    if (this.focusHeadingAfterDialog) {
      this.focusHeadingAfterDialog = false;
      this.returnFocus = null;
      this.focusHeading();
      return;
    }
    this.restoreFocus();
  }

  private focusHeading(): void {
    afterNextRender(() => this.byTest('panel-heading')?.focus(), { injector: this.injector });
  }

  private moveFocusOffDisabled(): void {
    const active = document.activeElement;
    const stranded =
      active === null ||
      active === document.body ||
      (active instanceof HTMLButtonElement && active.disabled);
    if (!stranded) return;
    (this.byTest('save-saveAsNew') ?? this.byTest('share'))?.focus();
  }

  private byTest<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return this.host.nativeElement.querySelector<T>(`[data-testid="${id}"]`);
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

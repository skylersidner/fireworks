import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Title } from '@angular/platform-browser';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import type { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { COLORS, RAINBOW, isPaletteColor } from '../../../../../engine/model/colors';
import {
  CUE_LIMITS,
  NAME_MAX_LENGTH,
  QUALITY_LIMITS,
  SHOW_LIMITS,
  SKY_LIMITS,
} from '../../../../../engine/model/limits';
import { PRESETS } from '../../../../../engine/model/presets';
import {
  STEPS_PER_SECOND,
  type EmbeddedShell,
  type ShowCue,
} from '../../../../../engine/model/show';
import { GROUND, WORLD_H } from '../../../../../engine/sim/constants';
import { ApiStatusService } from '../../../../core/api-status';
import { BROWSER_STORAGE, COARSE_POINTER_QUERY, mediaQuery } from '../../../../core/browser';
import type { SaveChoice } from '../../../../core/creation-save';
import type { CreationError } from '../../../../core/creations';
import type { CreationListItem } from '../../../../core/models';
import { SITE_TITLE, retryWhen } from '../../../../shared/link-copy';
import { ConfirmDialogComponent } from '../../../../shared/confirm-dialog';
import {
  FireworksStageComponent,
  type SkyClick,
  type StageStats,
  type TimelineFrameHook,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import { RangeRowComponent } from '../../../../shared/range-row';
import { TestModeBannerComponent } from '../../../../shared/test-mode-banner';
import { ApiBannerComponent } from '../../../designer/shared/api-banner/api-banner';
import { readDraft } from '../../../designer/shared/designer-draft';
import { percent, percentText, plain, windText } from '../../../designer/shared/formats';
import { HudComponent } from '../../../designer/shared/hud/hud';
import { SaveBarComponent } from '../../../designer/shared/save-bar/save-bar';
import { shareBlockedNote, type SaveStatusAction } from '../../../designer/shared/save-copy';
import { SaveStatusComponent } from '../../../designer/shared/save-status/save-status';
import {
  BUILDER_API_BANNER,
  BUILDER_NOTICE_OFF,
  BUILDER_NOTICE_ON,
  BUILDER_SUBTITLE,
  CONFIRM_KEEP,
  CONFIRM_NEW_ACTION,
  CONFIRM_NEW_TITLE,
  CONFIRM_OPEN_ACTION,
  CONFIRM_REMOVE_ACTION,
  CONFIRM_REMOVE_KEEP,
  CUE_CAP,
  DURATION_NOTE,
  HINT_COARSE,
  HINT_FINE,
  INSPECTOR_EMPTY,
  INSPECTOR_NONE,
  LIBRARY_NOTE,
  MY_SHELLS_EMPTY,
  NEW_SEED_TITLE,
  NOTICE_HOLDS_PLAY,
  PLAY_HELD_TITLE,
  POSITION_NOTE,
  SHOW_ENDED,
  SKY_NOTE,
  catchingUp,
  confirmNewBody,
  confirmOpenShowBody,
  confirmOpenShowTitle,
  confirmRemoveShellBody,
  confirmRemoveShellTitle,
  cueCount,
  cueTimesNote,
  durationBlockedNote,
  earlyEndNote,
  embeddedShellName,
  formatClock,
  formatTime,
  launchTimeRangeNote,
  mineGoneNote,
  mineNewerNote,
  mineOfflineNote,
  mineServerNote,
  pastWindow,
  selectedAnnouncement,
  spokenClock,
  spokenTime,
} from '../../shared/show-copy';
import type { ActiveShell } from '../../shared/show-draft';
import {
  cuesUsing,
  embeddable,
  lastLaunch,
  minDuration,
  roundUpTenth,
  shellOptionLabels,
} from '../../shared/show-edit';
import { ShowWorkingCopyHandoff } from '../../shared/show-working-copy-handoff';
import { ShowTimelineComponent, type ZoomCommand } from '../../shared/timeline/timeline';
import { viewRangeEnd } from '../../shared/timeline/timeline-layout';
import { ShowBuilderStore } from './show-builder.store';
import { ShowLibraryFlow } from './show-library';
import { ShowSaveFlow } from './show-save';

export const BUILDER_TITLE = `Show Builder · ${SITE_TITLE}`;

/** Where Space already means something (designer-2c.md §6.2's list). */
const SPACE_OWNERS =
  'input, textarea, select, button, a[href], summary, dialog, [contenteditable]:not([contenteditable="false"]), [role="tab"], [role="switch"], [role="button"], [role="checkbox"], [role="slider"]';
/**
 * Where ⌘/Ctrl+Z stays with the focused control (Peach N6): text fields, and every other native
 * form control the builder uses, select, range and checkbox (Skyler, 2026-11-14), so a key press
 * in the inspector or on the scrub bar never undoes the show.
 */
const FORM_FIELDS =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type]), input[type="text"], input[type="number"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"], input[type="password"], input[type="range"], input[type="checkbox"]';

interface LibraryItem {
  readonly ref: ActiveShell;
  readonly name: string;
  readonly meta: string;
  readonly swatches: readonly { background: string; glow: string }[];
  readonly testId: string;
}

/**
 * The Show Builder at `/show` (plan Phase 6; docs/fireworks-app/design/phase-6.md). One live stage
 * in timeline mode, a canvas timeline, the cue inspector and the shell library. Opens paused at
 * 0:00 every load and never auto-plays (§14.1). Playback frames write no signal: the playhead,
 * time and scrub bar are written through element refs from the stage's frame hook.
 */
@Component({
  selector: 'app-show-builder-page',
  imports: [
    ApiBannerComponent,
    ConfirmDialogComponent,
    FireworksStageComponent,
    HudComponent,
    NgTemplateOutlet,
    RangeRowComponent,
    RouterLink,
    SaveBarComponent,
    SaveStatusComponent,
    ShowTimelineComponent,
    TestModeBannerComponent,
  ],
  providers: [ShowBuilderStore, ShowSaveFlow, ShowLibraryFlow],
  templateUrl: './show-builder-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class ShowBuilderPageComponent {
  protected readonly store = inject(ShowBuilderStore);
  protected readonly saveFlow = inject(ShowSaveFlow);
  protected readonly library = inject(ShowLibraryFlow);
  private readonly storage = inject(BROWSER_STORAGE);
  /** The API banner only (§19.2 B1); the page reaches identity through ShowSaveFlow. */
  private readonly apiStatus = inject(ApiStatusService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly stage = viewChild(FireworksStageComponent);
  protected readonly timeline = viewChild(ShowTimelineComponent);
  private readonly timeText = viewChild<ElementRef<HTMLElement>>('timeText');
  private readonly scrubInput = viewChild<ElementRef<HTMLInputElement>>('scrub');
  private readonly stageBox = viewChild<ElementRef<HTMLElement>>('stageBox');
  protected readonly coarse = mediaQuery(COARSE_POINTER_QUERY);

  protected readonly L = { ...SKY_LIMITS, ...CUE_LIMITS, persistence: QUALITY_LIMITS.persistence };
  protected readonly durationRange = SHOW_LIMITS.duration;
  protected readonly nameMax = NAME_MAX_LENGTH;
  protected readonly plain = plain;
  protected readonly windText = windText;
  protected readonly percent = percent;
  protected readonly percentText = percentText;
  protected readonly fixed2 = (v: number) => v.toFixed(2);
  protected readonly copy = {
    subtitle: BUILDER_SUBTITLE,
    skyNote: SKY_NOTE,
    durationNote: DURATION_NOTE,
    inspectorNone: INSPECTOR_NONE,
    inspectorEmpty: INSPECTOR_EMPTY,
    positionNote: POSITION_NOTE,
    newSeedTitle: NEW_SEED_TITLE,
    libraryNote: LIBRARY_NOTE,
    myShellsEmpty: MY_SHELLS_EMPTY,
    playHeldTitle: PLAY_HELD_TITLE,
    noticeOff: BUILDER_NOTICE_OFF,
    noticeOn: BUILDER_NOTICE_ON,
    apiBanner: BUILDER_API_BANNER,
  };

  /** As the designer: shown while the API or `api/me` is unavailable, and while re-checking (§19.2 B1). */
  protected readonly showApiBanner = linkedSignal<string, boolean>({
    source: this.apiStatus.bannerStatus,
    computation: (status, previous) =>
      status === 'unavailable' || (status === 'checking' && (previous?.value ?? false)),
  });
  protected readonly apiChecking = computed(() => this.apiStatus.bannerStatus() === 'checking');
  protected readonly presetShell = PRESETS[0];
  protected readonly blockedNote = shareBlockedNote(isApplePlatform());

  /** Play state (never saved, never dirty). */
  protected readonly playing = signal(false);
  protected readonly stagePaused = computed(
    () => !this.playing() || this.store.flashNoticeVisible(),
  );
  protected readonly stats = signal<StageStats | null>(null);
  protected readonly catchingUpText = signal<string | null>(null);
  protected readonly stageSize = signal({ w: 0, h: 0 });
  protected readonly durationNote = signal<string | null>(null);
  protected readonly launchNote = signal<string | null>(null);
  protected readonly cueListOpen = signal(false);
  protected readonly markerDrag = signal<{ x: number; bh: number | null } | null>(null);
  /** Paused playhead time, refreshed when paused and on seek (not per frame). */
  protected readonly pausedAt = signal(0);
  /** The view range grows live when playback passes the estimate (§7.3). */
  private readonly overrun = signal(0);

  protected readonly viewEnd = computed(() =>
    viewRangeEnd(this.store.show().duration, Math.max(this.store.end(), this.overrun())),
  );
  protected readonly endText = computed(() =>
    this.store.knownEnd() !== null
      ? formatTime(this.store.knownEnd()!)
      : `about ${formatClock(this.store.end())}`,
  );

  protected readonly selectedIndex = computed(() => {
    const id = this.store.selectedCueId();
    return id === null ? -1 : this.store.ordered().findIndex((c) => c.id === id);
  });
  protected readonly shellOptions = computed(() => shellOptionLabels(this.store.show()));
  protected readonly selectedTimes = computed(() => {
    const cue = this.store.selectedCue();
    return cue ? this.store.timesOf(cue) : null;
  });

  /** The toolbar's right-hand status (§9.2, §5.2, §7.2), first match. */
  protected readonly toolbarStatus = computed(() => {
    const show = this.store.show();
    if (this.store.flashNoticeVisible()) return NOTICE_HOLDS_PLAY;
    if (show.cues.length >= 1000) return CUE_CAP;
    if (this.activeShellBlocked()) return this.store.blockText('shell-cap');
    if (!this.playing() && this.pausedAt() > show.duration + 1e-9) return pastWindow(show.duration);
    return cueCount(show.cues.length);
  });
  protected readonly earlyEnd = computed(() => {
    const show = this.store.show();
    const end = this.store.end();
    return show.cues.length > 0 && end < show.duration ? earlyEndNote(end, show.duration) : null;
  });
  protected readonly atCueCap = computed(() => this.store.show().cues.length >= 1000);

  // ---- Library -----------------------------------------------------------------------------

  private readonly designerShell = signal(this.readDesignerShell());
  protected readonly embeddedItems = computed<(LibraryItem & { key: string; used: number })[]>(
    () => {
      const show = this.store.show();
      return Object.keys(show.shells).map((key) => {
        const used = cuesUsing(show, key);
        return {
          key,
          used,
          ref: { kind: 'embedded', key },
          name: show.shells[key].name,
          meta: used === 0 ? 'Unused' : cueCount(used),
          swatches: swatches(show.shells[key]),
          testId: `lib-embedded-${key}`,
        };
      });
    },
  );
  protected readonly designerItem = computed<LibraryItem | null>(() => {
    const shell = this.designerShell();
    return shell
      ? {
          ref: { kind: 'designer' },
          name: shell.name,
          meta: 'Designer',
          swatches: swatches(shell),
          testId: 'lib-designer',
        }
      : null;
  });
  protected readonly presetItems: readonly LibraryItem[] = PRESETS.map((p, index) => ({
    ref: { kind: 'preset', index },
    name: p.name,
    meta: '',
    swatches: swatches(p),
    testId: `lib-preset-${index}`,
  }));
  protected readonly activeName = computed(() => {
    const ref = this.store.activeShell();
    switch (ref.kind) {
      case 'preset':
        return PRESETS[ref.index]?.name ?? '';
      case 'designer':
        return this.designerShell()?.name ?? '';
      case 'embedded':
        return Object.hasOwn(this.store.show().shells, ref.key)
          ? this.store.show().shells[ref.key].name
          : '';
      case 'mine':
        return ref.name;
    }
  });
  /** The active shell would be a 33rd shell (§9.2). */
  protected readonly activeShellBlocked = computed(() => {
    const show = this.store.show();
    if (Object.keys(show.shells).length < 32) return false;
    const ref = this.store.activeShell();
    if (ref.kind === 'embedded') return false;
    const shell =
      ref.kind === 'mine' ? (this.mineCache.get(ref.shareCode) ?? null) : this.localShell(ref);
    if (!shell) return ref.kind === 'mine';
    return this.store.addBlock(0, shell) === 'shell-cap';
  });

  protected readonly dialog = computed(() => {
    const pending = this.store.pending();
    if (!pending) return null;
    const show = untracked(this.store.show);
    if (pending.kind === 'link') {
      return {
        title: confirmOpenShowTitle(pending.copy.show.name),
        body: confirmOpenShowBody(show.name, pending.copy.show.name),
        confirm: CONFIRM_OPEN_ACTION,
        cancel: CONFIRM_KEEP,
        tone: 'primary' as const,
      };
    }
    if (pending.kind === 'new') {
      return {
        title: CONFIRM_NEW_TITLE,
        body: confirmNewBody(show.name, show.cues.length),
        confirm: CONFIRM_NEW_ACTION,
        cancel: CONFIRM_KEEP,
        tone: 'primary' as const,
      };
    }
    return {
      title: confirmRemoveShellTitle(show.shells[pending.key]?.name ?? ''),
      body: confirmRemoveShellBody(cuesUsing(show, pending.key)),
      confirm: CONFIRM_REMOVE_ACTION,
      cancel: CONFIRM_REMOVE_KEEP,
      tone: 'danger' as const,
    };
  });

  protected readonly mineFailureText = computed(() => {
    const f = this.library.itemFailure();
    if (!f) return null;
    if (f.failure === 'gone') return mineGoneNote(f.name);
    if (f.failure === 'network') return mineOfflineNote(f.name);
    if (f.failure === 'newer') return mineNewerNote(f.name);
    return mineServerNote(f.name);
  });

  private readonly mineCache = new Map<string, EmbeddedShell>();
  private mineRequest: Subscription | null = null;
  private recordedEndFor: TimelineDriver | null = null;
  private following = false;
  private scrubbing = false;
  private lastTenth = -1;
  private lastOverrunAt = 0;
  private focusHeadingAfterDialog = false;

  /** Per-frame playhead writes (no signals except one-off transitions). */
  protected readonly frameHook: TimelineFrameHook = (step, driver) => {
    const t = step / STEPS_PER_SECOND;
    this.timeline()?.setPlayhead(t, this.following && untracked(this.playing));
    const tenth = Math.round(t * 10);
    if (tenth !== this.lastTenth) {
      this.lastTenth = tenth;
      this.writeTime(t);
      const scrub = this.scrubInput()?.nativeElement;
      if (scrub && !this.scrubbing) {
        scrub.value = String(t);
        scrub.setAttribute('aria-valuetext', this.valueText(t));
      }
    }
    if (driver.done && driver.endStep !== null && this.recordedEndFor !== driver) {
      this.recordedEndFor = driver;
      if (driver === untracked(this.store.driver))
        this.store.recordEnd(driver.endStep / STEPS_PER_SECOND);
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (t > untracked(this.viewEnd) / 1.02 && now - this.lastOverrunAt > 250) {
      this.lastOverrunAt = now;
      this.overrun.set(t);
    }
  };

  constructor() {
    inject(Title).setTitle(BUILDER_TITLE);
    const copy = inject(ShowWorkingCopyHandoff).take();
    if (copy) {
      if (this.store.openWorkingCopy(copy)) this.focusHeading();
      else this.focusHeadingAfterDialog = true;
    }
    // The time readout is written only through its element ref (the frame hook writes it too), so
    // Angular never owns its text node.
    effect(() => {
      const t = this.pausedAt();
      this.endText();
      untracked(() => this.writeTime(t));
    });
    // Paused edits re-seek on the stage (it keeps the step across drivers); keep the paused time.
    effect(() => {
      this.store.driver();
      untracked(() => this.refreshPausedAt());
    });
    inject(DestroyRef).onDestroy(() => this.mineRequest?.unsubscribe());
    // The notice takes focus from body, to its first button (§14.1, §19.2 B3; player-notice.ts).
    effect(() => {
      if (!this.store.flashNoticeVisible()) return;
      afterNextRender(
        () => {
          const active = document.activeElement;
          if (active !== null && active !== document.body) return;
          this.byTest('flash-notice')?.querySelector<HTMLButtonElement>('button')?.focus();
        },
        { injector: this.injector },
      );
    });
    // Stage size, for the selected cue's marker (§8.2).
    afterNextRender(() => {
      const el = this.stageBox()?.nativeElement;
      if (!el) return;
      const measure = () => this.stageSize.set({ w: el.clientWidth, h: el.clientHeight });
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      }
    });
  }

  private readonly destroyRef = inject(DestroyRef);

  // ---- Transport ---------------------------------------------------------------------------

  protected togglePlay(): void {
    if (this.store.flashNoticeVisible()) return;
    if (this.playing()) {
      this.playing.set(false);
      this.refreshPausedAt();
      return;
    }
    const stage = this.stage();
    const driver = this.store.driver();
    if (stage && (driver.done || this.store.show().cues.length === 0)) stage.seek(0);
    this.following = true;
    this.playing.set(true);
  }

  protected backToStart(): void {
    this.seekTo(0);
  }

  protected zoom(command: ZoomCommand, around: number | null = null): void {
    const timeline = this.timeline();
    if (!timeline) return;
    this.following = false;
    this.store.setView(timeline.zoomView(command, around ?? this.currentTime(), this.store.view()));
    if (command !== 'fit') {
      afterNextRender(
        () => {
          const id = command === 'in' ? 'zoom-in' : 'zoom-out';
          const el = this.byTest<HTMLButtonElement>(id);
          if (el?.disabled && document.activeElement === el) this.byTest('zoom-fit')?.focus();
        },
        { injector: this.injector },
      );
    }
  }

  protected onViewChange(view: { pxPerSecond: number | null; scroll: number }): void {
    this.store.setView(view);
  }

  protected onScrubInput(event: Event): void {
    this.scrubbing = true;
    const t = Number((event.target as HTMLInputElement).value);
    this.timeline()?.setPlayhead(t);
    this.seekTo(t);
  }

  protected onScrubEnd(): void {
    this.scrubbing = false;
  }

  /** Seeks the stage (spread over frames; "Catching up…" past the configured delay, default 300 ms). Sets no flag, no draft. */
  protected seekTo(seconds: number): void {
    const t = Math.max(0, Math.min(seconds, this.viewEnd()));
    this.following = false;
    this.pausedAt.set(t);
    if (this.store.flashNoticeVisible()) return;
    this.stage()?.seek(Math.round(t * STEPS_PER_SECOND));
  }

  protected onScrub(t: number): void {
    this.writeTime(t);
  }

  /** `0:12.5 / about 1:07` (§5.2), straight to the DOM. */
  private writeTime(t: number): void {
    const text = this.timeText()?.nativeElement;
    if (text) text.textContent = `${formatTime(t)} / ${untracked(this.endText)}`;
  }

  protected onCatchingUp(step: number | null): void {
    this.catchingUpText.set(step === null ? null : catchingUp(step / STEPS_PER_SECOND));
  }

  protected onEnded(step: number): void {
    this.playing.set(false);
    this.store.recordEnd(step / STEPS_PER_SECOND);
    this.store.announcement.set(SHOW_ENDED);
    this.refreshPausedAt();
  }

  protected valueText(t: number): string {
    return `${spokenTime(t)} of about ${spokenClock(this.store.end())}`;
  }

  private currentTime(): number {
    const stage = this.stage();
    return stage ? stage.currentStep() / STEPS_PER_SECOND : this.pausedAt();
  }

  private refreshPausedAt(): void {
    this.pausedAt.set(this.currentTime());
  }

  // ---- Adding cues -------------------------------------------------------------------------

  protected selectLibrary(ref: ActiveShell): void {
    this.store.setActive(ref);
    if (ref.kind === 'designer') this.designerShell.set(this.readDesignerShell());
  }

  protected selectMine(item: CreationListItem): void {
    this.selectLibrary({ kind: 'mine', shareCode: item.shareCode, name: item.name });
  }

  protected isActive(ref: ActiveShell): boolean {
    const a = this.store.activeShell();
    if (a.kind !== ref.kind) return false;
    if (a.kind === 'preset' && ref.kind === 'preset') return a.index === ref.index;
    if (a.kind === 'embedded' && ref.kind === 'embedded') return a.key === ref.key;
    if (a.kind === 'mine' && ref.kind === 'mine') return a.shareCode === ref.shareCode;
    return true;
  }

  protected addAtPlayhead(): void {
    if (this.atCueCap()) {
      this.store.announcement.set(CUE_CAP);
      return;
    }
    this.addCue(this.currentTime(), 0.5);
  }

  protected onSkyClick(click: SkyClick): void {
    if (this.store.flashNoticeVisible()) return;
    this.addCue(this.currentTime(), click.x);
  }

  private addCue(at: number, x: number): void {
    const t = roundUpTenth(at);
    const ref = this.store.activeShell();
    if (ref.kind === 'mine') {
      const cached = this.mineCache.get(ref.shareCode);
      if (cached) {
        this.store.addCue(cached, t, x);
        return;
      }
      const block = this.store.addBlock(t, null);
      if (block) {
        this.store.announcement.set(this.store.blockText(block));
        return;
      }
      const state = this.library.state();
      const item =
        'items' in state ? state.items.find((i) => i.shareCode === ref.shareCode) : undefined;
      if (!item) return;
      this.mineRequest?.unsubscribe();
      this.mineRequest = this.library.fetchShell(item).subscribe((result) => {
        if (typeof result === 'string') {
          if (result === 'gone') this.store.setActive({ kind: 'preset', index: 0 });
          return;
        }
        this.mineCache.set(item.shareCode, result);
        this.store.addCue(result, t, x);
      });
      return;
    }
    const shell = this.localShell(ref);
    if (!shell) return;
    this.store.addCue(shell, t, x);
  }

  private localShell(ref: ActiveShell): EmbeddedShell | null {
    switch (ref.kind) {
      case 'preset':
        return embeddable(PRESETS[ref.index]);
      case 'designer': {
        // Read at the moment of the add, as it is now (§13.1); the designer draft is only read.
        const shell = this.readDesignerShell();
        this.designerShell.set(shell);
        return shell;
      }
      case 'embedded': {
        const show = this.store.show();
        return Object.hasOwn(show.shells, ref.key) ? show.shells[ref.key] : null;
      }
      default:
        return null;
    }
  }

  private readDesignerShell(): EmbeddedShell | null {
    const draft = readDraft(this.storage);
    return draft ? embeddable(draft.shell) : null;
  }

  // ---- Cue commands ------------------------------------------------------------------------

  protected onSelect(id: string | null): void {
    this.store.select(id);
  }

  protected onKeyboardSelected(id: string): void {
    const order = this.store.ordered();
    const i = order.findIndex((c) => c.id === id);
    if (i < 0) return;
    const cue = order[i];
    const times = this.store.timesOf(cue);
    this.store.announcement.set(
      selectedAnnouncement(
        i + 1,
        order.length,
        this.store.show().shells[cue.shell]?.name ?? '',
        cue.t,
        times?.burst ?? cue.t,
        cue.x,
      ),
    );
  }

  private moveAnnounceTimer: ReturnType<typeof setTimeout> | null = null;

  protected onNudge(dt: number): void {
    const id = this.store.selectedCueId();
    if (!id) return;
    this.store.nudgeCue(id, dt);
    if (this.moveAnnounceTimer) clearTimeout(this.moveAnnounceTimer);
    this.moveAnnounceTimer = setTimeout(() => {
      const cue = this.store.selectedCue();
      if (cue) this.store.announcement.set(formatTime(cue.t));
    }, 400);
  }

  protected duplicateSelected(): void {
    const id = this.store.selectedCueId();
    if (id) this.store.duplicateCue(id);
  }

  protected deleteSelected(fromInspector = false): void {
    const id = this.store.selectedCueId();
    if (!id) return;
    this.store.deleteCue(id);
    afterNextRender(
      () => {
        if (fromInspector && this.store.selectedCueId())
          this.byTest('inspector-duplicate')?.focus();
        else if (fromInspector || document.activeElement === document.body)
          this.timeline()?.focus();
      },
      { injector: this.injector },
    );
  }

  protected focusLaunchField(): void {
    this.byTest<HTMLInputElement>('inspector-t')?.focus();
  }

  protected setCueShell(key: string): void {
    const id = this.store.selectedCueId();
    if (id && Object.hasOwn(this.store.show().shells, key))
      this.store.updateCue(id, { shell: key });
  }

  /** Launch time: an out-of-range entry clamps on commit, with the note (§8.1). Not snapped. */
  protected commitLaunch(input: HTMLInputElement): void {
    const cue = this.store.selectedCue();
    if (!cue) return;
    const duration = this.store.show().duration;
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) {
      input.value = String(cue.t);
      this.launchNote.set(launchTimeRangeNote(duration));
      return;
    }
    const t = Math.min(duration, Math.max(0, v));
    this.launchNote.set(t === v ? null : launchTimeRangeNote(duration));
    if (t !== cue.t) this.store.moveCue(cue.id, t);
    input.value = String(t);
  }

  protected setX(v: number): void {
    const id = this.store.selectedCueId();
    if (id) this.store.updateCue(id, { x: v }, `x:${id}`);
  }

  protected setOwnHeight(on: boolean): void {
    const cue = this.store.selectedCue();
    if (!cue) return;
    const shell = this.store.show().shells[cue.shell];
    this.store.updateCue(cue.id, { burstHeight: on ? shell.burstHeight : undefined });
  }

  protected setBurstHeight(v: number): void {
    const id = this.store.selectedCueId();
    if (id) this.store.updateCue(id, { burstHeight: v }, `bh:${id}`);
  }

  protected newSeed(): void {
    const id = this.store.selectedCueId();
    if (id) this.store.newSeed(id);
  }

  protected shellNameOf(cue: ShowCue): string {
    return embeddedShellName(this.store.show(), cue.shell);
  }

  protected deleteLabel(cue: ShowCue): string {
    return `Delete cue at ${formatTime(cue.t)}`;
  }

  protected formatTime = formatTime;
  protected readonly hintFine = HINT_FINE;
  protected readonly hintCoarse = HINT_COARSE;
  protected readonly minDurationAttr = computed(() => minDuration(this.store.show()));

  protected cueNote(burst: number, fade: number): string {
    return cueTimesNote(burst, fade);
  }

  protected burstAt(cue: ShowCue): string {
    const times = this.store.timesOf(cue);
    return times ? formatTime(times.burst) : '';
  }

  /** §13.1 list errors, inline in the group. */
  protected mineErrorText(error: CreationError): string {
    if (error.kind === 'network') return "Couldn't load your shells. Check your connection.";
    if (error.kind === 'rate-limited') {
      return `Too many requests right now. Try again ${retryWhen(error.retryAfterSeconds)}.`;
    }
    return "Couldn't load your shells right now.";
  }

  // ---- Show fields -------------------------------------------------------------------------

  protected onName(value: string): void {
    this.store.setName(value);
  }

  protected commitDuration(input: HTMLInputElement): void {
    const show = this.store.show();
    const v = Number(input.value);
    if (
      input.value.trim() !== '' &&
      Number.isFinite(v) &&
      v >= minDuration(show) &&
      v <= 600 &&
      v >= 1
    ) {
      this.store.setDuration(v);
      this.durationNote.set(null);
    } else if (Number.isFinite(v) && v < minDuration(show) && show.cues.length) {
      this.durationNote.set(durationBlockedNote(lastLaunch(show)));
    }
    input.value = String(this.store.show().duration);
    this.store.endCoalesce();
  }

  protected newShow(): void {
    if (this.store.newShow()) this.afterReplace();
  }

  protected removeShell(key: string): void {
    this.store.removeShell(key);
  }

  // ---- Stage marker (§8.2) -----------------------------------------------------------------

  protected readonly marker = computed(() => {
    if (this.playing()) return null;
    const cue = this.store.selectedCue();
    const { w, h } = this.stageSize();
    if (!cue || w <= 0 || h <= 0) return null;
    const shell = this.store.show().shells[cue.shell];
    if (!shell) return null;
    const drag = this.markerDrag();
    const x = drag?.x ?? cue.x;
    const bh = drag?.bh ?? cue.burstHeight ?? shell.burstHeight;
    const scale = h / WORLD_H;
    return {
      left: x * w,
      top: (GROUND - bh * GROUND) * scale,
      ground: GROUND * scale,
      label: `${shell.name} · ${formatTime(cue.t)}`,
      /** Near the right edge the label sits left of the ring, so it isn't cut off. */
      labelLeft: x * w > w - 160,
    };
  });

  protected onMarkerDown(event: PointerEvent): void {
    const cue = this.store.selectedCue();
    const box = this.stageBox()?.nativeElement;
    if (!cue || !box) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    const own = cue.burstHeight !== undefined;
    const at = (e: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const worldY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * WORLD_H;
      const bh = own ? Math.min(0.85, Math.max(0.3, (GROUND - worldY) / GROUND)) : null;
      return { x: Math.round(x * 100) / 100, bh: bh === null ? null : Math.round(bh * 100) / 100 };
    };
    const move = (e: PointerEvent) => this.markerDrag.set(at(e));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const d = this.markerDrag();
      this.markerDrag.set(null);
      if (!d) return;
      const patch: Partial<ShowCue> = { x: d.x };
      if (own && d.bh !== null) patch.burstHeight = d.bh;
      this.store.updateCue(cue.id, patch);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  // ---- Save, notice, dialogs ---------------------------------------------------------------

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
    if (action === 'reload') location.reload();
    else if (action === 'retry') this.saveFlow.retry();
    else this.saveFlow.save('save');
  }

  protected retryApi(): void {
    this.apiStatus.retry();
  }

  /** Undo and Redo are aria-disabled, so a press with no history is ignored here (§19.2 B2). */
  protected undo(): void {
    if (this.store.canUndo()) this.store.undo();
  }

  protected redo(): void {
    if (this.store.canRedo()) this.store.redo();
  }

  protected dismissNotice(turnOn: boolean): void {
    this.store.dismissFlashNotice(turnOn);
    afterNextRender(() => this.byTest('play')?.focus(), { injector: this.injector });
  }

  protected confirmDialog(): void {
    const done = this.store.confirmPending();
    if (done && done.kind !== 'remove-shell') this.afterReplace();
    else this.afterDialog();
  }

  protected cancelDialog(): void {
    this.store.cancelPending();
    this.afterDialog();
  }

  private afterDialog(): void {
    if (this.focusHeadingAfterDialog) {
      this.focusHeadingAfterDialog = false;
      this.focusHeading();
    }
  }

  /** Open copy / New show: playhead 0:00, paused, nothing selected, focus on the h1 (§10.3). */
  private afterReplace(): void {
    this.focusHeadingAfterDialog = false;
    this.playing.set(false);
    this.stage()?.seek(0);
    this.pausedAt.set(0);
    this.focusHeading();
  }

  private focusHeading(): void {
    afterNextRender(() => this.byTest('panel-heading')?.focus(), { injector: this.injector });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const el = target instanceof Element ? target : null;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      // In a form control, the control's own key (Peach N6).
      if (el?.closest(FORM_FIELDS)) return;
      if (this.store.pending()) return;
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.store.pending() || this.store.flashNoticeVisible()) return;
    if (el?.closest(SPACE_OWNERS)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.togglePlay();
  }

  private byTest<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return this.host.nativeElement.querySelector<T>(`[data-testid="${id}"]`);
  }
}

function swatches(shell: Pick<EmbeddedShell, 'breaks'>): { background: string; glow: string }[] {
  return shell.breaks.slice(0, 8).map((b) => {
    if (b.color1 === RAINBOW) {
      return {
        background: 'conic-gradient(red, gold, lime, cyan, blue, magenta, red)',
        glow: '#ff5cc8',
      };
    }
    const hex = isPaletteColor(b.color1)
      ? `#${COLORS[b.color1].toString(16).padStart(6, '0')}`
      : '#fff';
    return { background: hex, glow: hex };
  });
}

function isApplePlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '');
}

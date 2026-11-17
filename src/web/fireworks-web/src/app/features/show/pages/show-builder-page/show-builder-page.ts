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
import { CUE_FIELD_LABELS } from '../../../../../engine/model/labels';
import { PRESETS } from '../../../../../engine/model/presets';
import {
  embeddedShell,
  STEPS_PER_SECOND,
  type EmbeddedShell,
  type ShowCue,
} from '../../../../../engine/model/show';
import { GROUND, WORLD_H } from '../../../../../engine/sim/constants';
import { ApiStatusService } from '../../../../core/api-status';
import {
  BROWSER_STORAGE,
  COARSE_POINTER_QUERY,
  isApplePlatform,
  isSaveShortcut,
  mediaQuery,
} from '../../../../core/browser';
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
import { AccountControlComponent } from '../../../../shared/sign-in/account-control';
import { watchIdentityFocus } from '../../../../shared/sign-in/identity-focus';
import { SignInDialogComponent } from '../../../../shared/sign-in/sign-in-dialog';
import type { SignInFrom } from '../../../../core/sign-in';
import { ApiBannerComponent, BannerFocus } from '../../../../shared/api-banner/api-banner';
import { readDraft } from '../../../designer/shared/designer-draft';
import { percent, percentText, plain, windText } from '../../../../shared/formats';
import { HudComponent } from '../../../../shared/hud/hud';
import { SaveBarComponent } from '../../../../shared/save-bar/save-bar';
import { shareBlockedNote, type SaveStatusAction } from '../../../../shared/save-copy';
import { SaveStatusComponent } from '../../../../shared/save-status/save-status';
import { saveShortcut } from '../../../../shared/save-shortcut';
import { liveNote, type LiveNoteEntry } from '../../../../shared/announcer';
import { JSON_NOTE_COPIED, copyBlockedNote } from '../../../designer/shared/designer-copy';
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
  DURATION_RANGE_NOTE,
  DROP_LABEL_CUE_CAP,
  DROP_LABEL_SHELL_CAP,
  HINT_COARSE,
  HINT_FINE,
  INSPECTOR_EMPTY,
  INSPECTOR_NONE,
  LIBRARY_NOTE,
  MY_SHELLS_EMPTY,
  NEW_SEED_TITLE,
  NOTICE_HOLDS_PLAY,
  PLAY_HELD_TITLE,
  SHELL_CAP,
  SKIP_TO_TRANSPORT,
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
import type { ActiveShell, TimelineView } from '../../shared/show-draft';
import {
  cuesUsing,
  embeddable,
  lastLaunch,
  minDuration,
  roundUpTenth,
  shellOptionLabels,
} from '../../shared/show-edit';
import { ShowWorkingCopyHandoff } from '../../shared/show-working-copy-handoff';
import {
  SHOW_JSON_CONFIRM_ACTION,
  SHOW_JSON_CONFIRM_TITLE,
  SHOW_JSON_NOTE_DEFAULT,
  SHOW_JSON_NOTE_EDITED,
  parseShowJson,
  showJsonConfirmBody,
  showJsonText,
} from '../../shared/show-json';
import { ScrubOverviewComponent } from '../../shared/timeline/scrub-overview';
import { ShowTimelineComponent, type ZoomCommand } from '../../shared/timeline/timeline';
import { viewRangeEnd } from '../../shared/timeline/timeline-layout';
import { ShowBuilderStore } from './show-builder.store';
import { ShowLibraryFlow } from './show-library';
import { ShowSaveFlow, saveDocumentOf } from './show-save';

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
    ScrubOverviewComponent,
    ShowTimelineComponent,
    AccountControlComponent,
    SignInDialogComponent,
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
  /** Inspector row labels, from labels.ts with every other row label (phase-7.md §9.4). */
  protected readonly cueLabels = CUE_FIELD_LABELS;
  protected readonly skipText = SKIP_TO_TRANSPORT;
  protected readonly shellCapText = SHELL_CAP;
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
  /** Rejected-entry notes; visible live regions that re-announce a repeat (phase-7.md §10 B4, B7). */
  protected readonly durationNote = liveNote();
  protected readonly launchNote = liveNote();
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

  /** The selected cue's embedded shell (an own key only, Boo F3), or null. */
  protected readonly selectedShell = computed(() => {
    const cue = this.store.selectedCue();
    return cue ? (embeddedShell(this.store.show(), cue.shell) ?? null) : null;
  });
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
        const shell = embeddedShell(show, key)!;
        const used = cuesUsing(show, key);
        return {
          key,
          used,
          ref: { kind: 'embedded', key },
          name: shell.name,
          meta: used === 0 ? 'Unused' : cueCount(used),
          swatches: swatches(shell),
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
        return embeddedShell(this.store.show(), ref.key)?.name ?? '';
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
    if (pending.kind === 'json') {
      return {
        title: SHOW_JSON_CONFIRM_TITLE,
        body: showJsonConfirmBody(show.name),
        confirm: SHOW_JSON_CONFIRM_ACTION,
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
      title: confirmRemoveShellTitle(embeddedShell(show, pending.key)?.name ?? ''),
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

  // ---- Show JSON (phase-7.md §9) -------------------------------------------------------------

  /** The disclosure is closed by default; its text exists only while it's open. */
  protected readonly jsonOpen = signal(false);
  private readonly jsonEdits = signal<string | null>(null);
  private readonly jsonNoteState = signal<{
    text: string;
    seq: number;
    json: string;
    edits: string | null;
  } | null>(null);
  private jsonNoteSeq = 0;
  /** The save document as text. Read only inside the open disclosure, so it's computed only then. */
  protected readonly jsonText = computed(() =>
    showJsonText(saveDocumentOf({ show: this.store.show() })),
  );
  protected readonly jsonValue = computed(() => this.jsonEdits() ?? this.jsonText());
  protected readonly jsonHasEdits = computed(() => {
    const edits = this.jsonEdits();
    return edits !== null && edits !== this.jsonText();
  });
  /** A set note holds until the next edit, Copy or Apply; else the edited or default note. */
  protected readonly jsonNote = computed<LiveNoteEntry>(() => {
    const note = this.jsonNoteState();
    if (note && note.json === this.jsonText() && note.edits === this.jsonEdits()) {
      return { text: note.text, seq: note.seq };
    }
    return this.jsonHasEdits()
      ? { text: SHOW_JSON_NOTE_EDITED, seq: -2 }
      : { text: SHOW_JSON_NOTE_DEFAULT, seq: -1 };
  });

  // ---- Library drag (phase-7.md §7.1) ---------------------------------------------------------

  /** The drag ghost chip, or null when no library drag is in progress. */
  protected readonly ghost = signal<{
    x: number;
    y: number;
    name: string;
    swatches: readonly { background: string; glow: string }[];
  } | null>(null);
  private endLibDrag: (() => void) | null = null;
  /** Where focus goes once a `Remove…` confirmation removes its row (K4). */
  private removeFocusTarget: string | null = null;

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

  /** Focus inside the API banner goes to the h1 when it unmounts (phase-7.md §10). */
  protected readonly bannerFocus = new BannerFocus(() => this.byTest('panel-heading'));

  constructor() {
    inject(Title).setTitle(BUILDER_TITLE);
    effect(() => {
      if (this.showApiBanner()) return;
      afterNextRender(() => this.bannerFocus.left(), { injector: this.injector });
    });
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
    inject(DestroyRef).onDestroy(() => {
      this.mineRequest?.unsubscribe();
      this.endLibDrag?.();
    });
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
    watchIdentityFocus({
      injector: this.injector,
      host: this.host.nativeElement,
      returned: this.saveFlow.auth.returned,
      barKey: computed(
        () =>
          `${this.saveFlow.auth.refreshing()}|${this.saveFlow.auth.prompt()}|${this.saveFlow.choices().join(',')}`,
      ),
      busy: computed(() => this.saveFlow.saving() !== null || this.saveFlow.replacing()),
      flashNoticeVisible: this.store.flashNoticeVisible,
      heading: () => this.byTest('panel-heading'),
    });
    // After any `/c/` working copy is applied: the return marker and the restore refresh.
    this.saveFlow.start();
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
    this.seekTo(0, true);
  }

  /** K8 (phase-7.md §3.2): focuses Play (Back to start while the notice holds Play); no scroll. */
  protected skipToTransport(event: Event): void {
    event.preventDefault();
    const target = this.store.flashNoticeVisible() ? 'back-to-start' : 'play';
    this.byTest(target)?.focus({ preventScroll: true });
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

  protected onViewChange(view: TimelineView): void {
    this.store.setView(view);
  }

  /** A pinch, pan, wheel scroll, trackpad zoom or badge zoom: stops Follow; never an Undo step (§6, §7.2). */
  protected onManualView(view: TimelineView): void {
    this.following = false;
    this.store.setView({ pxPerSecond: view.pxPerSecond, scroll: view.scroll });
  }

  protected onScrubInput(event: Event): void {
    this.scrubbing = true;
    const t = Number((event.target as HTMLInputElement).value);
    this.timeline()?.setPlayhead(t);
    this.seekTo(t, true);
  }

  protected onScrubEnd(): void {
    this.scrubbing = false;
  }

  /** Seeks the stage (spread over frames; "Catching up…" past the configured delay, default 300 ms). Sets no flag, no draft. */
  protected seekTo(seconds: number, reveal = false): void {
    const t = Math.max(0, Math.min(seconds, this.viewEnd()));
    this.following = false;
    this.pausedAt.set(t);
    // The seek-scroll rule (phase-7.md §7.3): a scrub-bar seek or Back to start that lands outside
    // the lane's window scrolls it there. Ruler and lane seeks are always inside the window.
    const view = reveal ? this.timeline()?.revealView(t) : null;
    if (view) this.store.setView(view);
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

  /** B6: the active item's `aria-describedby` → the 32-shell note under it, while blocked. */
  protected capNoteFor(ref: ActiveShell): string | null {
    return this.activeShellBlocked() && this.isActive(ref) ? 'lib-cap-note' : null;
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

  /** `snap` rounds up to a tenth (the playhead and sky adds); a library drop is already snapped. */
  private addCue(at: number, x: number, snap = true): void {
    const t = snap ? roundUpTenth(at) : at;
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
        return embeddedShell(show, ref.key) ?? null;
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
        embeddedShell(this.store.show(), cue.shell)?.name ?? '',
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

  /**
   * Edit cue (narrow dock, phase-7.md §5.4): scrolls the panel so the Cue section's heading is at
   * its top and focuses Launch time, as Enter on the timeline does.
   */
  protected editCue(): void {
    const panel = this.byTest('builder-panel');
    const section = this.byTest('inspector');
    if (panel && section) {
      panel.scrollTop += section.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    }
    this.byTest<HTMLInputElement>('inspector-t')?.focus({ preventScroll: true });
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
    const shell = embeddedShell(this.store.show(), cue.shell);
    if (!shell) return;
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

  /**
   * Duration commits on change (§9.3). B7 (phase-7.md §10): every rejected entry leaves a note
   * until the next valid one: below the last launch (with cues), the blocked note; otherwise a
   * blank, non-number, below-1 or above-600 entry, the range note.
   */
  protected commitDuration(input: HTMLInputElement): void {
    const show = this.store.show();
    const blank = input.value.trim() === '';
    const v = Number(input.value);
    const { min, max } = this.durationRange;
    if (!blank && Number.isFinite(v) && v >= minDuration(show) && v >= min && v <= max) {
      this.store.setDuration(v);
      this.durationNote.set(null);
    } else if (!blank && Number.isFinite(v) && show.cues.length && v < lastLaunch(show)) {
      this.durationNote.set(durationBlockedNote(lastLaunch(show)));
    } else {
      this.durationNote.set(DURATION_RANGE_NOTE);
    }
    input.value = String(this.store.show().duration);
    this.store.endCoalesce();
  }

  protected newShow(): void {
    if (this.store.newShow()) this.afterReplace();
  }

  /**
   * K4 (phase-7.md §3.2): the row goes, so focus goes to the next row's shell button in In this
   * show, else the previous row's, else the first preset. After a `Remove…` confirmation too.
   */
  protected removeShell(key: string): void {
    const keys = this.embeddedItems().map((i) => i.key);
    const at = keys.indexOf(key);
    const neighbour = keys[at + 1] ?? keys[at - 1];
    const target = neighbour !== undefined ? `lib-embedded-${neighbour}` : 'lib-preset-0';
    this.store.removeShell(key);
    if (this.store.pending()?.kind === 'remove-shell') {
      this.removeFocusTarget = target;
      return;
    }
    this.focusAfterRender(target);
  }

  // ---- Show JSON ------------------------------------------------------------------------------

  protected onJsonToggle(open: boolean): void {
    this.jsonOpen.set(open);
    if (!open) {
      this.jsonEdits.set(null);
      this.jsonNoteState.set(null);
    }
  }

  protected onJsonEdit(text: string): void {
    this.jsonEdits.set(text);
  }

  /** Revert removes itself, so focus goes to the textarea (as the designer's, K2). */
  protected revertJson(): void {
    this.jsonEdits.set(null);
    this.byTest<HTMLTextAreaElement>('show-json-text')?.focus();
  }

  /**
   * Copy copies the textarea's text, unapplied edits included, as the designer's Shell JSON does
   * (phase-7.md §9.1, C2 ruling). With no edits that's the document, so a round trip deep-equals
   * the source.
   */
  protected async copyJson(): Promise<void> {
    const text = this.jsonValue();
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      this.setJsonNote(JSON_NOTE_COPIED);
    } catch {
      const area = this.byTest<HTMLTextAreaElement>('show-json-text');
      area?.focus();
      area?.select();
      this.setJsonNote(copyBlockedNote(isApplePlatform()));
    }
  }

  /**
   * Apply (phase-7.md §9.1): parse and `openShow` (parseShowJson), then replace the show as one
   * Undo step, asking first over a dirty show. Focus stays on Apply; the note says what happened.
   */
  protected applyJson(): void {
    const parsed = parseShowJson(this.jsonValue());
    if (!parsed.ok) {
      this.setJsonNote(parsed.note);
      return;
    }
    if (this.store.applyJson(parsed.show, parsed.note)) this.afterJsonApplied(parsed.note);
  }

  private afterJsonApplied(note: string): void {
    this.jsonEdits.set(null);
    this.playing.set(false);
    this.stage()?.seek(0);
    this.pausedAt.set(0);
    this.setJsonNote(note);
  }

  private setJsonNote(text: string): void {
    this.jsonNoteState.set({
      text,
      seq: ++this.jsonNoteSeq,
      json: this.jsonText(),
      edits: this.jsonEdits(),
    });
  }

  // ---- Library drag ---------------------------------------------------------------------------

  /**
   * A fine-pointer drag from a Library item onto the timeline (phase-7.md §7.1). Under 4 px it's a
   * click (the button's own handler). Touch never drags: there a drag in the panel is its scroll.
   */
  protected onLibDown(
    event: PointerEvent,
    ref: ActiveShell,
    name: string,
    itemSwatches: readonly { background: string; glow: string }[],
  ): void {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    this.endLibDrag?.();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    const timeline = () => this.timeline();
    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        dragging = true;
      }
      this.ghost.set({ x: e.clientX, y: e.clientY, name, swatches: itemSwatches });
      const drop = timeline()?.dropAt(e.clientX, e.clientY, e.altKey) ?? null;
      timeline()?.showDrop(drop ? { t: drop.t, label: this.dropLabel(ref, drop) } : null);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      this.endLibDrag = null;
      this.ghost.set(null);
      timeline()?.showDrop(null);
    };
    const up = (e: PointerEvent) => {
      const wasDragging = dragging;
      finish();
      if (!wasDragging) return;
      const drop = timeline()?.dropAt(e.clientX, e.clientY, e.altKey) ?? null;
      if (drop) this.dropLibrary(ref, drop.t);
    };
    const cancel = () => finish();
    // Escape cancels: nothing changes and nothing is announced.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    this.endLibDrag = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }

  /** The drag label: the time, `· window end` at the clamp, or why a drop would be blocked. */
  private dropLabel(ref: ActiveShell, drop: { t: number; atEnd: boolean }): string {
    const block = this.dropBlock(ref);
    if (block === 'cue-cap') return DROP_LABEL_CUE_CAP;
    if (block === 'shell-cap') return DROP_LABEL_SHELL_CAP;
    return drop.atEnd ? `${formatTime(drop.t)} \u00b7 window end` : formatTime(drop.t);
  }

  private dropBlock(ref: ActiveShell): 'cue-cap' | 'shell-cap' | null {
    if (this.atCueCap()) return 'cue-cap';
    if (ref.kind === 'embedded') return null;
    const shell =
      ref.kind === 'mine' ? (this.mineCache.get(ref.shareCode) ?? null) : this.localShell(ref);
    return shell && this.store.addBlock(0, shell) === 'shell-cap' ? 'shell-cap' : null;
  }

  /**
   * A drop: the item becomes active (also when blocked, so B6's note shows under it), then the
   * same add as Add cue at the drop time, x 0.5, no burstHeight. The new cue is selected and focus
   * moves to the timeline. Blocked: nothing is added and the full sentence is announced.
   */
  private dropLibrary(ref: ActiveShell, t: number): void {
    this.selectLibrary(ref);
    const block = this.dropBlock(ref);
    if (block) {
      this.store.announcement.set(this.store.blockText(block));
      return;
    }
    this.addCue(t, 0.5, false);
    afterNextRender(() => this.timeline()?.focus(), { injector: this.injector });
  }

  // ---- Stage marker (§8.2) -----------------------------------------------------------------

  protected readonly marker = computed(() => {
    if (this.playing()) return null;
    const cue = this.store.selectedCue();
    const { w, h } = this.stageSize();
    if (!cue || w <= 0 || h <= 0) return null;
    const shell = embeddedShell(this.store.show(), cue.shell);
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

  /** The sign-in dialog's variant while it is open (phase-8.md §5.3). */
  protected readonly signInDialog = signal<SignInFrom | null>(null);

  protected openSignIn(variant: SignInFrom): void {
    this.signInDialog.set(variant);
  }

  protected onStatusAction(action: SaveStatusAction): void {
    if (action === 'reload') location.reload();
    else if (action === 'retry') this.saveFlow.retry();
    else if (action === 'signIn') this.openSignIn('save');
    else if (action === 'replace') this.saveFlow.replace();
    // 412: Save as new is the remix (phase-8.md §9.2); after a PUT 404 the source is gone.
    else if (this.saveFlow.choices().includes('saveAsNew')) this.saveFlow.save('saveAsNew');
    else this.saveFlow.save('save');
  }

  protected retryApi(): void {
    this.apiStatus.retry();
  }

  /** Undo and Redo are aria-disabled, so a press with no history is ignored here (§19.2 B2). */
  protected undo(): void {
    if (this.store.canUndo()) this.historyStep(false);
  }

  protected redo(): void {
    if (this.store.canRedo()) this.historyStep(true);
  }

  /**
   * B5 (phase-7.md §10, K3): after an undo or redo, if focus is left on body, a disabled control or
   * a removed node, it moves in the next render: from the inspector or the toolbar to the timeline,
   * from the save bar or anywhere else to the panel h1.
   */
  private historyStep(redo: boolean): void {
    const before = document.activeElement;
    const fromEditor =
      before instanceof Element &&
      before.closest('[data-testid="inspector"], [data-testid="toolbar"]') !== null;
    const done = redo ? this.store.redo() : this.store.undo();
    if (!done) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        const lost =
          active === null ||
          active === document.body ||
          !active.isConnected ||
          (active instanceof HTMLButtonElement && active.disabled) ||
          (active instanceof HTMLInputElement && active.disabled);
        if (!lost) return;
        if (fromEditor) this.timeline()?.focus();
        else this.byTest('panel-heading')?.focus();
      },
      { injector: this.injector },
    );
  }

  protected dismissNotice(turnOn: boolean): void {
    this.store.dismissFlashNotice(turnOn);
    afterNextRender(() => this.byTest('play')?.focus(), { injector: this.injector });
  }

  protected confirmDialog(): void {
    const done = this.store.confirmPending();
    if (done?.kind === 'json') {
      this.afterJsonApplied(done.note);
      this.focusAfterRender('show-json-apply');
    } else if (done?.kind === 'remove-shell') {
      this.focusAfterRender(this.removeFocusTarget ?? 'lib-preset-0');
      this.removeFocusTarget = null;
      this.afterDialog();
    } else if (done) this.afterReplace();
    else this.afterDialog();
  }

  protected cancelDialog(): void {
    const kind = this.store.pending()?.kind;
    this.store.cancelPending();
    this.removeFocusTarget = null;
    // Focus returns to Apply on close (phase-7.md §9.3).
    if (kind === 'json') this.focusAfterRender('show-json-apply');
    this.afterDialog();
  }

  /**
   * K9 (phase-7.md §3.2): Try again stays rendered and busy while the list loads. On success focus
   * goes to the first My shells item, else the `My shells` heading; on failure it stays on Try again.
   */
  protected retryMine(): void {
    const button = this.byTest('mine-retry');
    this.library.retry((ok) => {
      if (ok) this.focusMineAfterLoad(button, 0);
    });
  }

  /** K9: Show more → the first newly loaded item (or stays on Show more if it still renders). */
  protected showMoreMine(): void {
    const button = this.byTest('mine-more');
    this.library.showMore((ok, firstNew) => {
      if (ok) this.focusMineAfterLoad(button, firstNew);
    });
  }

  /** Moves focus only if it's still on the pressed button (or dropped), never away from elsewhere. */
  private focusMineAfterLoad(pressed: HTMLElement | null, index: number): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active !== pressed && active !== null && active !== document.body) return;
        const items = this.byTest('lib-mine')?.querySelectorAll<HTMLElement>('ul > li > button');
        const target =
          items?.[index] ?? (pressed?.isConnected ? pressed : null) ?? this.byTest('mine-heading');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusAfterRender(testId: string): void {
    afterNextRender(() => this.byTest(testId)?.focus(), { injector: this.injector });
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
    if (isSaveShortcut(event)) {
      this.onSaveShortcut(event, el);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      // In a form control, the control's own key (Peach N6).
      if (el?.closest(FORM_FIELDS)) return;
      if (this.store.pending()) return;
      event.preventDefault();
      this.historyStep(event.shiftKey);
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

  /**
   * Ctrl/⌘+S (phase-7.md §3.3, R1), only while the save bar shows. The field being typed in
   * commits first, through its own blur/change commit and notes, so its value is in the save.
   */
  private onSaveShortcut(event: KeyboardEvent, el: Element | null): void {
    if (!this.saveFlow.canWrite() && !this.saveFlow.auth.prompt()) return;
    if (!this.store.pending() && !this.saveFlow.busy()) {
      const id = el instanceof HTMLInputElement ? el.dataset['testid'] : undefined;
      if (id === 'show-duration') this.commitDuration(el as HTMLInputElement);
      else if (id === 'inspector-t') this.commitLaunch(el as HTMLInputElement);
      else if (id === 'show-name') this.store.endCoalesce();
    }
    const outcome = saveShortcut({
      canWrite: this.saveFlow.canWrite(),
      prompt: this.saveFlow.auth.prompt(),
      dialogOpen: this.store.pending() !== null || this.signInDialog() !== null,
      saving: this.saveFlow.busy(),
      saved: this.store.saved(),
      cannotSave: this.saveFlow.cannotSave(),
      choices: this.saveFlow.choices(),
    });
    if (outcome.kind === 'pass') return;
    event.preventDefault();
    if (outcome.kind === 'prompt') this.openSignIn('save');
    else if (outcome.kind === 'save') this.save(outcome.choice);
    else if (outcome.kind === 'announce') this.store.announcement.set(outcome.text);
    else if (outcome.kind === 'choose') {
      this.byTest('save-update')?.focus();
      this.store.announcement.set(outcome.text);
    }
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

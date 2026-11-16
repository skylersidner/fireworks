import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { isApplePlatform } from '../../core/browser';
import type { CreationSource, SaveChoice } from '../../core/creation-save';
import {
  FRESH_NOTE,
  INDICATOR_NOT_SAVED,
  INDICATOR_SAVED,
  INDICATOR_SAVING,
  NON_OWNER_NOTE,
  SAVED_TITLE,
  SAVE_AS_NEW_LABEL,
  SAVE_LABEL,
  SAVING_LABEL,
  SHARE_LABEL,
  UPDATE_LABEL,
  ownerNote,
} from '../save-copy';

const LABELS: Readonly<Record<SaveChoice, string>> = {
  save: SAVE_LABEL,
  update: UPDATE_LABEL,
  saveAsNew: SAVE_AS_NEW_LABEL,
};

/**
 * The save bar in the panel header (phase-5.md §2). Presentational: the page passes the state and
 * handles the outputs. The save buttons render only when `canWrite`; Share needs only a `source`
 * (a share link is public and copying it writes nothing, §5).
 *
 * During a save every save button is `aria-disabled` and ignores clicks, not `disabled`, so the
 * pressed one keeps focus (§12.1). While the indicator reads `Saved`, Save and Update original are
 * disabled (§2.2); Save as new stays enabled.
 */
@Component({
  selector: 'app-save-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'save-bar' },
  template: `
    <div class="mb-1 flex flex-wrap items-center gap-1.5">
      @if (canWrite()) {
        @for (choice of choices(); track choice) {
          <button
            type="button"
            class="btn border-accent text-accent"
            [attr.data-testid]="'save-' + choice"
            [class.btn-busy]="saving() !== null"
            [attr.aria-disabled]="saving() !== null ? 'true' : null"
            [attr.aria-keyshortcuts]="choice === 'save' ? keyShortcut : null"
            [disabled]="isDisabled(choice) || cannotSaveNote() !== null"
            [attr.title]="isDisabled(choice) ? savedTitle : null"
            (click)="press(choice)"
          >
            {{ saving() === choice ? savingLabel : labels[choice] }}
          </button>
        }
      }
      @if (source()) {
        <button type="button" class="btn" data-testid="share" (click)="share.emit()">
          {{ shareLabel }}
        </button>
      }
      @if (indicator(); as text) {
        <p
          class="m-0 ml-auto text-caption"
          [class.text-success]="text === savedText"
          [class.text-muted]="text !== savedText"
          data-testid="save-indicator"
        >
          {{ text }}
        </p>
      }
    </div>
    @if (note(); as text) {
      <p class="note mb-2.5" data-testid="save-note">{{ text }}</p>
    }
    @if (blockedLink(); as link) {
      <div class="mb-2.5" data-testid="share-blocked">
        <input
          #linkField
          class="field font-mono text-caption"
          readonly
          aria-label="Share link"
          data-testid="share-link-field"
          [value]="link"
          (focus)="linkField.select()"
        />
        <p class="note">{{ blockedNote() }}</p>
      </div>
    }
  `,
})
export class SaveBarComponent {
  readonly canWrite = input(false);
  readonly source = input<CreationSource | null>(null);
  readonly choices = input<readonly SaveChoice[]>(['save']);
  readonly saving = input<SaveChoice | null>(null);
  readonly saved = input(false);
  readonly dirty = input(false);
  readonly blockedLink = input<string | null>(null);
  readonly blockedNote = input('');
  /**
   * Save can't be offered yet (a show with no cues, phase-6.md §9.1): the buttons stay visible but
   * disabled, and this note replaces the owner note. Nothing is sent.
   */
  readonly cannotSaveNote = input<string | null>(null);

  readonly save = output<SaveChoice>();
  readonly share = output<void>();

  protected readonly labels = LABELS;
  protected readonly savingLabel = SAVING_LABEL;
  protected readonly shareLabel = SHARE_LABEL;
  protected readonly savedTitle = SAVED_TITLE;
  protected readonly savedText = INDICATOR_SAVED;
  /** Ctrl/⌘+S (phase-7.md §3.3): on the single-choice Save only; no visible hint. */
  protected readonly keyShortcut = isApplePlatform() ? 'Meta+S' : 'Control+S';

  /** §2.3, first match. Not a live region (§12.3). */
  protected readonly indicator = computed(() => {
    if (!this.canWrite()) return null;
    if (this.saving() !== null) return INDICATOR_SAVING;
    if (this.saved()) return INDICATOR_SAVED;
    if (this.source() || this.dirty()) return INDICATOR_NOT_SAVED;
    return null;
  });

  /** §2.2 and §5: the note under the bar. */
  protected readonly note = computed(() => {
    if (!this.canWrite()) return null;
    const blocked = this.cannotSaveNote();
    if (blocked !== null) return blocked;
    const source = this.source();
    if (!source) return FRESH_NOTE;
    return source.isOwner ? ownerNote(source.name) : NON_OWNER_NOTE;
  });

  protected isDisabled(choice: SaveChoice): boolean {
    return this.saved() && this.saving() === null && choice !== 'saveAsNew';
  }

  protected press(choice: SaveChoice): void {
    if (this.saving() !== null || this.isDisabled(choice) || this.cannotSaveNote() !== null) return;
    this.save.emit(choice);
  }
}

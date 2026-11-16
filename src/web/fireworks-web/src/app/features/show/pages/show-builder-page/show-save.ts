import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { normalizeShow } from '../../../../../engine/model/normalize';
import { validateShow } from '../../../../../engine/model/validate';
import {
  MAX_BODY_BYTES,
  saveChoices,
  saveCreation,
  type SaveChoice,
} from '../../../../core/creation-save';
import { CreationsService } from '../../../../core/creations';
import { NotificationService } from '../../../../core/notifications';
import { SessionService } from '../../../../core/session';
import { isShareCode } from '../../../../core/share-code';
import {
  SHARE_COPIED,
  SHARE_COPIED_UNSAVED,
  fellBackStatus,
  invalidStatus,
  saveFailureStatus,
  savedToast,
  tooLargeStatus,
  type SaveStatus,
} from '../../../../shared/save-copy';
import { EMPTY_SAVE_NOTE, showIssueReason } from '../../shared/show-copy';
import type { ShowDocument } from '../../../../../engine/model/show';
import { ShowBuilderStore, type ShowSaveSnapshot } from './show-builder.store';

/**
 * Save and Share for the Show Builder (plan Phase 6; schema.md §11.4, the same rules as shells;
 * phase-6.md §9.1, §10). `@Injectable()`, provided by the builder page. With the library flow,
 * the only builder files that reach SessionService or the creations API (designer-structure.spec).
 *
 *  - An empty show can't be saved (Skyler Q4): `cannotSave` is the note, and `save` sends nothing.
 *  - The document sent is the show through `normalizeShow` (a blank name saves as "Custom"), then
 *    `validateShow` must pass, then the 256 KiB check, then one request (plus at most one fallback).
 *  - Body keys are `kind`, `document` for a POST and `document` for PUT and remix (creations.ts).
 */
@Injectable()
export class ShowSaveFlow {
  private readonly store = inject(ShowBuilderStore);
  private readonly creations = inject(CreationsService);
  private readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationService);

  readonly canWrite = this.session.canWrite;
  readonly choices = computed(() => saveChoices(this.store.source()));
  readonly saving = signal<SaveChoice | null>(null);
  readonly status = signal<SaveStatus | null>(null);
  readonly blockedLink = signal<string | null>(null);
  /** §9.1: the note that replaces the owner note while the show has no cues. */
  readonly cannotSave = computed(() =>
    this.store.show().cues.length === 0 ? EMPTY_SAVE_NOTE : null,
  );

  private lastChoice: SaveChoice = 'save';
  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      this.store.show();
      untracked(() => this.blockedLink.set(null));
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  save(choice: SaveChoice): void {
    if (this.saving() !== null || !this.session.canWrite()) return;
    if (this.cannotSave() !== null) return;
    const source = this.store.source();
    if (!saveChoices(source).includes(choice)) return;
    this.blockedLink.set(null);
    this.lastChoice = choice;

    const sent = this.store.snapshotForSave();
    const document = saveDocumentOf(sent);
    const checked = validateShow(document);
    if (!checked.ok) {
      this.status.set(
        invalidStatus(checked.errors, (i) => showIssueReason(i, document), false, 'show'),
      );
      return;
    }
    const body = JSON.stringify({ kind: 'show', document });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      this.status.set(tooLargeStatus('show'));
      return;
    }
    let request$: ReturnType<typeof saveCreation>;
    try {
      request$ = saveCreation(this.creations, { source, choice, kind: 'show', document });
    } catch {
      this.status.set(
        saveFailureStatus(
          { kind: 'unexpected', status: null },
          'create',
          '',
          (i) => showIssueReason(i, document),
          'show',
        ),
      );
      return;
    }
    this.status.set(null);
    this.saving.set(choice);
    this.request = request$.subscribe((outcome) => {
      this.saving.set(null);
      this.request = null;
      if (outcome.ok) {
        this.store.completeSave(outcome.source, sent);
        if (outcome.fellBack) this.status.set(fellBackStatus(outcome.response.name));
        else {
          this.notifications.success(
            savedToast(outcome.request, choice === 'saveAsNew', outcome.response.name),
          );
        }
        return;
      }
      if (
        outcome.fellBack ||
        (outcome.request === 'update' && outcome.error.kind === 'not-found')
      ) {
        this.store.forgetSource();
      }
      this.status.set(
        saveFailureStatus(
          outcome.error,
          outcome.request,
          source?.name ?? '',
          (i) => showIssueReason(i, document),
          'show',
        ),
      );
      if (outcome.error.kind === 'forbidden') this.session.load().subscribe();
    });
  }

  retry(): void {
    const offered = this.choices();
    this.save(offered.includes(this.lastChoice) ? this.lastChoice : offered[0]);
  }

  dismissStatus(): void {
    this.status.set(null);
  }

  async share(): Promise<'copied' | 'blocked' | 'none'> {
    const source = this.store.source();
    this.blockedLink.set(null);
    if (!source || !isShareCode(source.shareCode)) return 'none';
    const link = `${location.origin}/s/${source.shareCode}`;
    const saved = this.store.saved();
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
    } catch {
      this.blockedLink.set(link);
      return 'blocked';
    }
    this.notifications.success(saved ? SHARE_COPIED : SHARE_COPIED_UNSAVED);
    return 'copied';
  }
}

/**
 * The document a Save sends for `sent` (6f.3's keys, in normalize's order, no UI state). Show JSON
 * shows exactly this text, so Copy in one engine and Apply in another round-trip (phase-7.md §9.1).
 */
export function saveDocumentOf(sent: ShowSaveSnapshot): ShowDocument {
  const normalized = normalizeShow(sent.show);
  return normalized.ok ? normalized.show : sent.show;
}

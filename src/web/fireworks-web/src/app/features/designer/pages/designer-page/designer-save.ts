import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { validateShell } from '../../../../../engine/model/validate';
import {
  MAX_BODY_BYTES,
  replaceCreation,
  saveChoices,
  saveCreation,
  type SaveChoice,
  type SaveOutcome,
} from '../../../../core/creation-save';
import { SaveSession } from '../../../../core/save-session';
import { CreationsService } from '../../../../core/creations';
import { NotificationService } from '../../../../core/notifications';
import { SessionService } from '../../../../core/session';
import { isShareCode } from '../../../../core/share-code';
import {
  SHARE_COPIED,
  SHARE_COPIED_UNSAVED,
  TOO_LARGE_STATUS,
  fellBackStatus,
  invalidStatus,
  saveFailureStatus,
  savedToast,
  type SaveStatus,
} from '../../../../shared/save-copy';
import { issueReason } from '../../shared/designer-copy';
import { ShellDesignerStore } from './shell-designer.store';

/**
 * Save and Share for the Shell Designer (plan Phase 5; schema.md §11.4; phase-5.md §2–§6).
 * `@Injectable()`, provided by the designer page next to its store. **This and the `/c/:code` page
 * are the only designer files that may reach SessionService or the creations API**; the page itself
 * reaches only ApiStatusService, for the API banner (designer-structure.spec.ts). The store and the
 * draft stay free of HTTP and identity.
 *
 *  - Every write needs `session.canWrite()`; `isOwner` only picks which buttons show (Boo C7, A40).
 *    Signed out, the bar's one Save opens the sign-in dialog and nothing is sent (`auth.prompt`).
 *  - A 401 is the signed-out row; the 401 interceptor has reloaded the session, and nothing retries
 *    (A41). A 412 offers Save as new and Replace (phase-8.md §9.2).
 *  - One request per press: a press while a save is in flight is ignored (acceptance 5b.10).
 *  - Strict validation and the 256 KiB check run before any request (§3.1).
 *  - Failures go to `status` (the panel's status block), never a toast; successes are toasts.
 */
@Injectable()
export class DesignerSaveFlow {
  private readonly store = inject(ShellDesignerStore);
  private readonly creations = inject(CreationsService);
  private readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationService);

  readonly canWrite = this.session.canWrite;
  /** Signed out (prompt), the restore refresh (`refreshing`) and the return (`returned`). */
  readonly auth = new SaveSession({
    session: this.session,
    creations: this.creations,
    notifications: this.notifications,
    path: '/',
    source: () => this.store.source(),
    refresh: (fresh) => this.store.refreshSource(fresh),
    forget: () => this.store.forgetSource(),
  });
  /** 412's Replace is running (phase-8.md §9.2): the bar is busy and the block's button reads Replacing…. */
  readonly replacing = signal(false);
  /** A save, a Replace or the restore refresh is in flight: presses and ⌘S are held. */
  readonly busy = computed(
    () => this.saving() !== null || this.replacing() || this.auth.refreshing(),
  );
  /** The choices the bar offers, by `source` (§2.2). */
  readonly choices = computed(() => saveChoices(this.store.source()));
  /** The button whose save is in flight, or null. */
  readonly saving = signal<SaveChoice | null>(null);
  /** The status block's message (§6), or null. */
  readonly status = signal<SaveStatus | null>(null);
  /** The link Share couldn't copy, shown selected under the bar (§5), or null. */
  readonly blockedLink = signal<string | null>(null);

  private lastChoice: SaveChoice = 'save';
  private request: Subscription | null = null;

  constructor() {
    // "It goes away on the next Share, Save or any edit" (§5).
    effect(() => {
      this.store.model();
      untracked(() => this.blockedLink.set(null));
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      this.authStart?.unsubscribe();
    });
  }

  private authStart: Subscription | null = null;

  /** The page calls this once, after applying any `/c/` working copy (SaveSession.start). */
  start(): void {
    this.authStart ??= this.auth.start();
  }

  /** Flushes the draft before the sign-in navigation (phase-8.md §5.4). */
  readonly flushDraft = (): void => this.store.flushDraft();

  /**
   * One Save press. `choice` must be one the bar offers for the current `source`; the status
   * block's `Save as new` after a PUT 404 calls this with `save`, because `source` is null by then.
   */
  save(choice: SaveChoice): void {
    if (this.busy() || !this.session.canWrite()) return;
    const source = this.store.source();
    if (!saveChoices(source).includes(choice)) return;
    this.blockedLink.set(null);
    this.lastChoice = choice;

    const sent = this.store.snapshotForSave();
    const checked = validateShell(sent.shell);
    if (!checked.ok) {
      this.status.set(invalidStatus(checked.errors, issueReason));
      return;
    }
    // What is sent is the captured shell (key order as plan §3.3 shows a document, sky before
    // breaks), which strict validation has just accepted unchanged. The body is compact JSON
    // (schema.md §2.5); PUT and remix bodies have no `kind`, so the POST body is the safe bound.
    const document = sent.shell;
    const body = JSON.stringify({ kind: 'shell', document });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      this.status.set(TOO_LARGE_STATUS);
      return;
    }

    // `saveCreation` plans synchronously and throws for a plan it can't make (a `source` of another
    // kind). Build it before `saving` is set, so a throw never leaves the bar at `Saving…`.
    let request$: ReturnType<typeof saveCreation>;
    try {
      request$ = saveCreation(this.creations, { source, choice, kind: 'shell', document });
    } catch {
      this.status.set(
        saveFailureStatus({ kind: 'unexpected', status: null }, 'create', '', issueReason),
      );
      return;
    }
    this.status.set(null);
    this.run(choice, request$, sent, source?.name ?? '');
  }

  /**
   * 412's `Replace the newer version` (phase-8.md §9.2): a fresh GET, then a PUT with its tag. A
   * 404 or a non-owner answer there is row 404a, and the source is forgotten (§11.2 writer 3).
   */
  replace(): void {
    if (this.busy() || !this.session.canWrite()) return;
    const source = this.store.source();
    if (!source?.isOwner) return;
    this.blockedLink.set(null);
    this.lastChoice = 'update';
    const sent = this.store.snapshotForSave();
    const checked = validateShell(sent.shell);
    if (!checked.ok) {
      this.status.set(invalidStatus(checked.errors, issueReason));
      return;
    }
    this.replacing.set(true);
    this.run(
      null,
      replaceCreation(this.creations, source.shareCode, 'shell', sent.shell),
      sent,
      source.name,
    );
  }

  /** `choice` is the bar button pressed, or null for the status block's Replace. */
  private run(
    choice: SaveChoice | null,
    request$: ReturnType<typeof saveCreation>,
    sent: ReturnType<ShellDesignerStore['snapshotForSave']>,
    sourceName: string,
  ): void {
    this.saving.set(choice);
    this.request = request$.subscribe((outcome: SaveOutcome) => {
      this.saving.set(null);
      this.replacing.set(false);
      this.request = null;
      if (outcome.ok) {
        this.status.set(null);
        this.store.completeSave(outcome.source, sent);
        if (outcome.fellBack) {
          this.status.set(fellBackStatus(outcome.response.name));
        } else {
          this.notifications.success(
            savedToast(outcome.request, choice === 'saveAsNew', outcome.response.name),
          );
        }
        return;
      }
      // A 404 from PUT or a remix: the source is gone to this visitor (schema.md §11.2, Y2).
      if (
        outcome.fellBack ||
        (outcome.request === 'update' && outcome.error.kind === 'not-found')
      ) {
        this.store.forgetSource();
      }
      this.status.set(saveFailureStatus(outcome.error, outcome.request, sourceName, issueReason));
    });
  }

  /** The status block's `Try again`: the save that failed, as it would be offered now. */
  retry(): void {
    const offered = this.choices();
    this.save(offered.includes(this.lastChoice) ? this.lastChoice : offered[0]);
  }

  dismissStatus(): void {
    this.status.set(null);
  }

  /**
   * Copies `{origin}/s/{source.shareCode}` (Boo C11; phase-5.md §5). Never saves. A blocked
   * clipboard shows the link, selected, instead of a toast. Returns the outcome for focus handling.
   */
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

import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CreationsService, toCreationError, type CreationError } from '../../../../core/creations';
import type { CreationListItem } from '../../../../core/models';
import { isShareCode } from '../../../../core/share-code';

/** Cards per page (phase-5.md §10.3; schema.md §2.2.1): fills 2, 3, 4 or 6 columns evenly. */
export const MINE_PAGE_SIZE = 24;

export type MineListState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly page: number }
  | {
      readonly status: 'ready';
      readonly page: number;
      readonly items: readonly CreationListItem[];
      readonly totalCount: number;
    }
  | { readonly status: 'error'; readonly error: CreationError };

export type DeleteOutcome = 'deleted' | 'already-deleted' | CreationError;

/**
 * My creations' list state (plan Phase 5; phase-5.md §10). `@Injectable()`, provided by the page.
 * It only fetches when the page asks, and the page asks only once the session has settled with
 * `canWrite` true (Peach N1), so a visit with writes off makes no `api/me/creations` call.
 * Phase 5 lists shells only (coordinator default for Q4).
 */
@Injectable()
export class MineStore {
  private readonly creations = inject(CreationsService);

  readonly state = signal<MineListState>({ status: 'idle' });
  /** The code being deleted, so its Delete ignores a second press. */
  readonly deleting = signal<string | null>(null);

  private request: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  load(page: number): void {
    this.request?.unsubscribe();
    this.state.set({ status: 'loading', page });
    this.request = this.creations
      .listMine({ page, pageSize: MINE_PAGE_SIZE, kind: 'shell' })
      .subscribe({
        next: (result) => {
          // Every code is checked before any URL is built from it (Boo C4).
          const items = (result.items ?? []).filter((item) => {
            if (isShareCode(item.shareCode)) return true;
            console.warn('My creations: skipped an item with a malformed share code');
            return false;
          });
          this.state.set({
            status: 'ready',
            page: result.page,
            items,
            totalCount: result.totalCount,
          });
        },
        error: (error: unknown) =>
          this.state.set({ status: 'error', error: toCreationError(error) }),
      });
  }

  /** Deletes one creation. A 404 means it's already gone: the desired state holds (success). */
  delete(shareCode: string, done: (outcome: DeleteOutcome) => void): void {
    if (this.deleting() !== null) return;
    this.deleting.set(shareCode);
    this.creations.delete(shareCode).subscribe({
      next: () => {
        this.deleting.set(null);
        done('deleted');
      },
      error: (error: unknown) => {
        this.deleting.set(null);
        const e = toCreationError(error);
        done(e.kind === 'not-found' ? 'already-deleted' : e);
      },
    });
  }
}

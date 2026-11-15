import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subscription, map, of } from 'rxjs';
import type { EmbeddedShell } from '../../../../../engine/model/show';
import { CreationsService, toCreationError, type CreationError } from '../../../../core/creations';
import { openCreation } from '../../../../core/open-creation';
import type { CreationListItem } from '../../../../core/models';
import { SessionService } from '../../../../core/session';
import { isShareCode } from '../../../../core/share-code';
import { embeddable } from '../../shared/show-edit';

/** The library's "My shells" page size (Peach 6e.1; phase-6.md §13.1). */
export const MY_SHELLS_PAGE_SIZE = 24;

export type MyShellsState =
  | { readonly status: 'hidden' }
  | { readonly status: 'loading'; readonly items: readonly CreationListItem[] }
  | {
      readonly status: 'ready';
      readonly items: readonly CreationListItem[];
      readonly page: number;
      readonly more: boolean;
    }
  | {
      readonly status: 'error';
      readonly items: readonly CreationListItem[];
      readonly error: CreationError;
    };

/** Why one of my shells couldn't be fetched for an add (phase-6.md §13.1). */
export type MineFetchFailure = 'gone' | 'network' | 'server' | 'newer';

/**
 * "My shells" in the builder's library (plan Phase 6, Peach F9, 6e): follows the write switch like
 * `/mine`. Nothing is fetched while `api/me` is loading; when it settles with `canWrite` the list
 * is `GET api/me/creations?page=1&pageSize=24&kind=shell`, and `Show more` appends the next page.
 * With writes off, or `api/me` failed, the group is hidden and nothing is sent. A 403 hides it.
 * Adding one of my shells costs one `GET api/creations/{code}` (Peach N2), then upgrade and
 * normalize, without `sky`.
 */
@Injectable()
export class ShowLibraryFlow {
  private readonly creations = inject(CreationsService);
  private readonly session = inject(SessionService);

  readonly state = signal<MyShellsState>({ status: 'hidden' });
  /** The code being fetched for an add, or null. */
  readonly fetching = signal<string | null>(null);
  /** Inline failure under one item: `{ code, failure }`. */
  readonly itemFailure = signal<{
    code: string;
    name: string;
    failure: MineFetchFailure;
  } | null>(null);

  private request: Subscription | null = null;
  private fetchRequest: Subscription | null = null;
  private started = false;

  constructor() {
    effect(() => {
      const status = this.session.status();
      const canWrite = this.session.canWrite();
      untracked(() => {
        if (status !== 'ready' || !canWrite) {
          this.request?.unsubscribe();
          this.started = false;
          this.state.set({ status: 'hidden' });
          return;
        }
        if (!this.started) {
          this.started = true;
          this.load(1, []);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      this.fetchRequest?.unsubscribe();
    });
  }

  retry(): void {
    const s = this.state();
    if (s.status !== 'error') return;
    const page = Math.floor(s.items.length / MY_SHELLS_PAGE_SIZE) + 1;
    this.load(page, s.items);
  }

  showMore(): void {
    const s = this.state();
    if (s.status !== 'ready' || !s.more) return;
    this.load(s.page + 1, s.items);
  }

  private load(page: number, items: readonly CreationListItem[]): void {
    this.request?.unsubscribe();
    this.state.set({ status: 'loading', items });
    this.request = this.creations
      .listMine({ page, pageSize: MY_SHELLS_PAGE_SIZE, kind: 'shell' })
      .subscribe({
        next: (result) => {
          const fresh = (result.items ?? []).filter(
            (item) => item.kind === 'shell' && isShareCode(item.shareCode),
          );
          const all = [...items, ...fresh];
          this.state.set({
            status: 'ready',
            items: all,
            page: result.page,
            more: result.page * result.pageSize < result.totalCount,
          });
        },
        error: (error: unknown) => {
          const e = toCreationError(error);
          if (e.kind === 'forbidden') {
            this.state.set({ status: 'hidden' });
            return;
          }
          this.state.set({ status: 'error', items, error: e });
        },
      });
  }

  /**
   * Fetches one of my shells for an add (phase-6.md §13.1). Emits the embeddable shell, or a
   * failure; a 404 also removes the item from the list.
   */
  fetchShell(item: CreationListItem): Observable<EmbeddedShell | MineFetchFailure> {
    if (!isShareCode(item.shareCode)) return of<MineFetchFailure>('gone');
    this.itemFailure.set(null);
    this.fetching.set(item.shareCode);
    // Through openCreation, like every read of a shared creation (Boo C4, C5): pattern, kind, upgrade,
    // normalize. A show at that code (it can't be one of my shells) reads as gone.
    return openCreation(this.creations, item.shareCode).pipe(
      map((opened): EmbeddedShell | MineFetchFailure => {
        switch (opened.status) {
          case 'shell':
            return embeddable(opened.shell) ?? 'server';
          case 'not-found':
          case 'show':
            return 'gone';
          case 'network':
            return 'network';
          case 'newer':
            return 'newer';
          default:
            return 'server';
        }
      }),
      map((result) => {
        this.fetching.set(null);
        if (typeof result === 'string') {
          this.itemFailure.set({ code: item.shareCode, name: item.name, failure: result });
          if (result === 'gone') this.removeItem(item.shareCode);
        }
        return result;
      }),
    );
  }

  private removeItem(code: string): void {
    const s = this.state();
    if (s.status === 'ready')
      this.state.set({ ...s, items: s.items.filter((i) => i.shareCode !== code) });
  }
}

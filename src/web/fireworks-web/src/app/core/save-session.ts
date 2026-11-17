import { computed, signal, type Signal } from '@angular/core';
import { Subscription, finalize, of, switchMap } from 'rxjs';
import { refreshSource, type CreationSource } from './creation-save';
import type { CreationsService } from './creations';
import type { NotificationService } from './notifications';
import type { SessionService } from './session';
import { signedInToast, takeSignInIntent, type SignInFrom } from './sign-in';

export interface SaveSessionDeps {
  readonly session: SessionService;
  readonly creations: CreationsService;
  readonly notifications: NotificationService;
  /** The page's path, which the return marker must match (`/` or `/show`). */
  readonly path: string;
  /** The store's current `source`. */
  readonly source: () => CreationSource | null;
  /** schema.md §11.2 writer 4: set `isOwner` and `name`, keep `updatedAt`. */
  readonly refresh: (fresh: CreationSource) => void;
  /** A 404 from the refresh: `source` becomes null. */
  readonly forget: () => void;
}

/** The return from sign-in, for the page's focus move (phase-8.md §6.2). `seq` makes repeats new. */
export interface SignInReturn {
  readonly from: SignInFrom;
  readonly seq: number;
}

/**
 * The identity side of a page's Save flow (designer and Show Builder), shared so both behave the
 * same (phase-8.md §5, §6; schema.md §11.2 writer 4; Boo A40, A41). Plain class: the flow builds it
 * with its own injected services, so neither the stores nor the page reach identity.
 *
 *  - `prompt`: the session is decided and signed out, so the bar renders one Save that opens the
 *    sign-in dialog (A40). Nothing renders while `loading` or `unavailable`.
 *  - `start()`, called once by the page after it has applied any `/c/` working copy: reads (and
 *    deletes) the return marker, waits for `session.settled()`, then, signed in with the restored
 *    draft's `source` still in place, sends exactly one `GET api/creations/{code}` (`refreshing`
 *    while it runs). When that settles and the visitor is signed in and came back from sign-in, it
 *    toasts `Signed in as {name}.` and sets `returned`. **It never saves** (A41).
 */
export class SaveSession {
  readonly refreshing = signal(false);
  private readonly returnedState = signal<SignInReturn | null>(null);
  readonly returned: Signal<SignInReturn | null> = this.returnedState.asReadonly();
  readonly prompt: Signal<boolean>;

  private started = false;
  private seq = 0;
  /**
   * The draft's `source` as the store restored it, captured when the flow is built: before the
   * page applies any `/c/` handoff, whose source is a fresh read and needs no refresh.
   */
  private readonly restored: CreationSource | null;

  constructor(private readonly deps: SaveSessionDeps) {
    this.restored = deps.source();
    this.prompt = computed(() => deps.session.status() === 'ready' && !deps.session.canWrite());
  }

  start(): Subscription {
    if (this.started) return Subscription.EMPTY;
    this.started = true;
    const { session, creations, notifications } = this.deps;
    const intent = takeSignInIntent(this.deps.path);
    const restored = this.restored;
    return session
      .settled()
      .pipe(
        switchMap(() => {
          // Only the draft's own source, and only while it's still the one restored (a `/c/` load
          // replaced it with a fresh read). Signed out, or with no source: no request.
          if (!session.isAuthenticated() || restored === null || this.deps.source() !== restored) {
            return of(null);
          }
          this.refreshing.set(true);
          return refreshSource(creations, restored).pipe(
            finalize(() => this.refreshing.set(false)),
          );
        }),
      )
      .subscribe((result) => {
        if (result && this.deps.source() === restored) {
          if (result.kind === 'refreshed') this.deps.refresh(result.source);
          else if (result.kind === 'gone') this.deps.forget();
        }
        if (intent && session.isAuthenticated()) {
          notifications.success(signedInToast(session.displayName()));
          this.returnedState.set({ from: intent.from, seq: ++this.seq });
        }
      });
  }
}

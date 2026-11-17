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
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { COLORS, RAINBOW, isPaletteColor } from '../../../../../engine/model/colors';
import { COLOR_LABELS } from '../../../../../engine/model/labels';
import type { CreationError } from '../../../../core/creations';
import type { CreationListItem } from '../../../../core/models';
import { NotificationService } from '../../../../core/notifications';
import { SessionService } from '../../../../core/session';
import { isolate } from '../../../../shared/bidi';
import { ConfirmDialogComponent } from '../../../../shared/confirm-dialog';
import { SITE_TITLE, retryWhen } from '../../../../shared/link-copy';
import { MessagePageComponent } from '../../../../shared/message-page/message-page';
import { ClientConfigStore } from '../../../../core/client-config';
import { signedInToast, takeSignInIntent } from '../../../../core/sign-in';
import { AccountControlComponent } from '../../../../shared/sign-in/account-control';
import { GoogleSignInButtonComponent } from '../../../../shared/sign-in/google-sign-in-button';
import { SignInDialogComponent } from '../../../../shared/sign-in/sign-in-dialog';
import { MINE_PAGE_SIZE, MineStore, type DeleteOutcome } from './mine.store';
import { announcement } from '../../../../shared/announcer';

/** The `Loading…` line waits this long (phase-5.md §10.1). */
export const MINE_LOADING_DELAY_MS = 300;

export const MINE_TITLE = `My creations · ${SITE_TITLE}`;

interface Swatch {
  readonly label: string;
  readonly background: string;
  readonly glow: string;
}

/** A card as rendered: the item plus display-only derived text. `updatedAt` stays a token. */
interface Card {
  readonly item: CreationListItem;
  readonly swatches: readonly Swatch[];
  readonly colorsLabel: string;
  readonly updatedText: string;
  readonly updatedTitle: string;
}

type Notice = 'signed-out' | 'session-error' | null;

/**
 * My creations at `/mine` (plan Phase 5; phase-5.md §10; phase-8.md §7). It decides only once
 * `api/me` has settled (Peach N1). Signed out it renders the sign-in prompt in place (no guard and
 * no redirect; phase-8-auth.md §6.3, which restates Boo A44 as a page rule) and never calls
 * `api/me/creations`; a 401 from the list or a delete swaps to the same prompt. Cards show palette swatches, never a stage. Names are
 * text in `<bdi>` (Boo C1, C3); every URL is built from a checked share code, never a name (C2, C4).
 */
@Component({
  selector: 'app-mine-page',
  imports: [
    AccountControlComponent,
    ConfirmDialogComponent,
    GoogleSignInButtonComponent,
    MessagePageComponent,
    RouterLink,
    SignInDialogComponent,
  ],
  providers: [MineStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './mine-page.html',
})
export class MinePageComponent {
  protected readonly session = inject(SessionService);
  protected readonly store = inject(MineStore);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  private readonly pageParam = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('page'))),
    { initialValue: this.route.snapshot.queryParamMap.get('page') },
  );
  /** A `page` that isn't a positive integer reads as 1 (§10.6). */
  protected readonly page = computed(() => {
    const raw = this.pageParam();
    return raw !== null && /^[1-9][0-9]{0,5}$/.test(raw) ? Number(raw) : 1;
  });

  protected readonly showLoading = signal(false);
  /** The server said "signed out" here (a 401 from a delete). Cleared when the session reloads. */
  private readonly signedOutByServer = signal(false);

  protected readonly notice = computed<Notice>(() => {
    const status = this.session.status();
    if (status === 'loading') return null;
    if (status === 'unavailable') return 'session-error';
    if (!this.session.canWrite() || this.signedOutByServer()) return 'signed-out';
    const state = this.store.state();
    if (state.status === 'error' && state.error.kind === 'unauthorized') return 'signed-out';
    return null;
  });

  /** The prompt's Google button comes back here, with the page (phase-8.md §7). */
  protected readonly returnPath = computed(() =>
    this.page() > 1 ? `/mine?page=${this.page()}` : '/mine',
  );
  protected readonly signInAvailable = inject(ClientConfigStore).signInAvailable;
  protected readonly signInDialog = signal(false);

  protected readonly cards = computed<readonly Card[]>(() => {
    const state = this.store.state();
    if (state.status !== 'ready') return [];
    return state.items.map(toCard);
  });
  protected readonly pageCount = computed(() => {
    const state = this.store.state();
    return state.status === 'ready' ? Math.max(1, Math.ceil(state.totalCount / MINE_PAGE_SIZE)) : 1;
  });
  protected readonly listError = computed(() => {
    const state = this.store.state();
    if (state.status !== 'error' || state.error.kind === 'unauthorized') return null;
    return listErrorCopy(state.error);
  });

  protected readonly pendingDelete = signal<CreationListItem | null>(null);
  protected readonly blockedShare = signal<{ code: string; link: string } | null>(null);
  /** Repeats re-announce (phase-7.md §10 B4). */
  protected readonly pageAnnouncement = announcement();
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];
  protected readonly signedOutBody = [
    "Sign in to see the shells and shows you've saved. You can design and play without signing in; your work is kept in this browser.",
  ];
  protected readonly signInUnavailableBody = [
    "Sign-in isn't available right now, so there's nothing to list here. You can keep designing; your work is kept in this browser.",
  ];
  protected readonly sessionErrorBody = [
    "My creations can't load right now. You can keep designing; your work is kept in this browser.",
  ];
  protected readonly blockedNote = `Copy was blocked. The link is selected; press ${
    isApple() ? '⌘C' : 'Ctrl+C'
  } to copy it.`;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private focusAfterDelete: number | null = null;

  constructor() {
    inject(Title).setTitle(MINE_TITLE);
    this.timer = setTimeout(() => this.showLoading.set(true), MINE_LOADING_DELAY_MS);
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
    // The h1 on load (§12.1). A full-page notice focuses its own h1 instead.
    this.focusHeading();

    // Normalize a bad `page` in the URL (§10.6).
    effect(() => {
      const raw = this.pageParam();
      if (raw !== null && String(this.page()) !== raw) {
        untracked(() => this.goToPage(1, true));
      }
    });

    // Decide once the session has settled signed in (Peach N1), then follow `page`. Signed out:
    // zero list calls (phase-8-auth.md §6.3, Boo A44).
    effect(() => {
      const ready = this.session.status() === 'ready' && this.session.canWrite();
      const page = this.page();
      if (!ready || untracked(this.signedOutByServer)) return;
      untracked(() => this.store.load(page));
    });
    // A fresh session answer replaces what a 401 implied.
    effect(() => {
      if (this.session.status() === 'loading') untracked(() => this.signedOutByServer.set(false));
    });

    // The return from sign-in (phase-8.md §6.1, §7): the toast; the h1 is focused on load anyway.
    // Nothing else happens because of it (Boo A41).
    const intent = takeSignInIntent('/mine');
    if (intent) {
      this.session
        .settled()
        .pipe(takeUntilDestroyed())
        .subscribe(() => {
          if (this.session.isAuthenticated()) {
            this.notifications.success(signedInToast(this.session.displayName()));
          }
        });
    }

    // A page past the end goes to the last page; a page emptied by a delete, to the one before.
    effect(() => {
      const state = this.store.state();
      if (state.status !== 'ready') return;
      if (state.items.length === 0 && state.totalCount > 0) {
        const last = Math.max(1, Math.ceil(state.totalCount / MINE_PAGE_SIZE));
        untracked(() => this.goToPage(Math.min(last, Math.max(1, state.page - 1)), true));
        return;
      }
      if (this.focusAfterDelete !== null) {
        const index = this.focusAfterDelete;
        this.focusAfterDelete = null;
        untracked(() => this.focusCard(index));
      }
    });
  }

  protected retrySession(): void {
    this.session.load().subscribe();
  }

  /** K6 (phase-7.md §3.2): the error card leaves with its button, so focus goes to the h1. */
  protected retryList(): void {
    this.store.load(this.page());
    this.focusHeading();
  }

  protected changePage(page: number): void {
    this.goToPage(page, false);
    this.pageAnnouncement.set(`Page ${page} of ${this.pageCount()}.`);
    this.focusHeading();
  }

  protected askDelete(item: CreationListItem): void {
    this.pendingDelete.set(item);
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  protected confirmDelete(): void {
    const item = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!item) return;
    const index = this.cards().findIndex((c) => c.item.shareCode === item.shareCode);
    this.store.delete(item.shareCode, (outcome) => this.afterDelete(item, index, outcome));
  }

  protected async share(item: CreationListItem): Promise<void> {
    this.blockedShare.set(null);
    const link = `${location.origin}/s/${item.shareCode}`;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      this.notifications.success('Share link copied.');
    } catch {
      this.blockedShare.set({ code: item.shareCode, link });
      // Focus, then select, as the designer does (§5): select() alone doesn't move focus.
      afterNextRender(
        () => {
          const field = this.host.nativeElement.querySelector<HTMLInputElement>(
            '[data-testid="share-link-field"]',
          );
          field?.focus();
          field?.select();
        },
        { injector: this.injector },
      );
    }
  }

  /** `Delete “{name}”?` for the dialog; without the `?` for the card's button label. */
  protected deleteTitle(name: string, question = true): string {
    return `Delete \u201c${isolate(name)}\u201d${question ? '?' : ''}`;
  }

  private afterDelete(item: CreationListItem, index: number, outcome: DeleteOutcome): void {
    const name = `“${isolate(item.name)}”`;
    if (outcome === 'deleted' || outcome === 'already-deleted') {
      this.notifications.success(
        outcome === 'deleted' ? `Deleted ${name}.` : `${name} was already deleted.`,
      );
      this.focusAfterDelete = index;
      this.store.load(this.page());
      return;
    }
    if (outcome.kind === 'unauthorized') {
      // The 401 interceptor reloads the session; the page swaps to the prompt (§7).
      this.notifications.error("You've been signed out, so nothing was deleted.");
      this.signedOutByServer.set(true);
      return;
    }
    this.notifications.error(deleteErrorCopy(name, outcome));
  }

  private goToPage(page: number, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page === 1 ? null : page },
      replaceUrl,
    });
  }

  private focusHeading(): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>('[data-testid="mine-heading"]')?.focus(),
      { injector: this.injector },
    );
  }

  /** After a delete: the next card's name link, else the previous card's, else the h1 (§10.4). */
  private focusCard(index: number): void {
    afterNextRender(
      () => {
        const links = this.host.nativeElement.querySelectorAll<HTMLElement>(
          '[data-testid="card-open"]',
        );
        const target = links[Math.min(index, links.length - 1)];
        if (target) target.focus();
        else
          this.host.nativeElement
            .querySelector<HTMLElement>('[data-testid="mine-heading"]')
            ?.focus();
      },
      { injector: this.injector },
    );
  }
}

function toCard(item: CreationListItem): Card {
  const swatches: Swatch[] = [];
  for (const name of (item.palette ?? []).slice(0, 8)) {
    if (name === RAINBOW) {
      swatches.push({
        label: COLOR_LABELS[RAINBOW],
        background: 'conic-gradient(red, gold, lime, cyan, blue, magenta, red)',
        glow: '0 0 6px #ff5cc8',
      });
    } else if (isPaletteColor(name)) {
      const hex = `#${COLORS[name].toString(16).padStart(6, '0')}`;
      swatches.push({ label: COLOR_LABELS[name], background: hex, glow: `0 0 6px ${hex}` });
    }
    // An unknown color name from the server is skipped: only engine colors are drawn.
  }
  const updated = Date.parse(item.updatedAt);
  return {
    item,
    swatches,
    colorsLabel: `Colors: ${swatches.map((s) => s.label).join(', ')}`,
    updatedText: Number.isNaN(updated) ? '' : relativeTime(updated, Date.now()),
    updatedTitle: Number.isNaN(updated) ? '' : new Date(updated).toLocaleString(),
  };
}

/** `Intl.RelativeTimeFormat`, `just now` under a minute (§10.3). Display only. */
export function relativeTime(then: number, now: number): string {
  const seconds = Math.round((then - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

function listErrorCopy(error: CreationError): { heading: string; body: string } {
  if (error.kind === 'network') {
    return {
      heading: "Couldn't load your creations.",
      body: 'Check your connection and try again.',
    };
  }
  if (error.kind === 'rate-limited') {
    return {
      heading: 'Too many requests right now.',
      body: `Try again ${retryWhen(error.retryAfterSeconds)}.`,
    };
  }
  return { heading: 'Something went wrong on the server.', body: 'Try again in a moment.' };
}

function deleteErrorCopy(name: string, error: CreationError): string {
  if (error.kind === 'network')
    return `Couldn't delete ${name}: can't reach the server. Try again.`;
  if (error.kind === 'rate-limited') {
    return `Couldn't delete ${name}: too many changes in a short time. Try again ${retryWhen(error.retryAfterSeconds)}.`;
  }
  return `Couldn't delete ${name}: something went wrong on the server. Try again in a moment.`;
}

function isApple(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '');
}

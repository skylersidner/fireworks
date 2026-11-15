import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { DEFAULT_SKY } from '../../../../../engine/model/shell';
import { sourceFrom } from '../../../../core/creation-save';
import { CreationsService } from '../../../../core/creations';
import { openCreation, type OpenedCreation } from '../../../../core/open-creation';
import {
  SITE_TITLE,
  invalidMessage,
  loadFailureMessage,
  newerVersionMessage,
  notFoundMessage,
  retryWhen,
  type LinkAction,
  type LinkMessage,
} from '../../../../shared/link-copy';
import { MessagePageComponent } from '../../../../shared/message-page/message-page';
import { editableFrom } from '../../shared/designer-draft';
import { WorkingCopyHandoff } from '../../shared/working-copy-handoff';
import { ShowWorkingCopyHandoff } from '../../../show/shared/show-working-copy-handoff';

/** The "Opening…" line waits this long, so a fast load shows nothing (phase-5.md §7.1). */
export const OPENING_DELAY_MS = 300;

/**
 * `/c/:shareCode`, the only editing link (schema.md §11.1): it loads and redirects, never stays.
 * GET → runtime `kind` → upgrade → normalize (`openCreation`) → a working copy with exactly the
 * saved settings (`DEFAULT_SKY` when the record has none, §11.2) → handed to the designer → `/`
 * with `replaceUrl`, so Back skips this and a reload restores the edited copy from the draft. The
 * designer asks first over shell or sky changes (§11.3), showing the confirm over itself.
 *
 * It only reads: one GET, no write (Boo C13). It never touches the draft; on any failure the
 * draft is exactly as it was. The redirect target is fixed (Boo C14): query parameters are ignored.
 */
@Component({
  selector: 'app-open-link-page',
  imports: [MessagePageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-h-dvh bg-surface-sunken' },
  template: `
    @if (message(); as m) {
      <app-message-page [heading]="m.heading" [body]="m.body">
        @for (a of m.actions; track a.action; let first = $first) {
          <button
            type="button"
            class="btn"
            [class.btn-primary]="first"
            [attr.data-testid]="'message-' + a.action"
            (click)="act(a.action)"
          >
            {{ a.label }}
          </button>
        }
      </app-message-page>
    } @else if (showOpening()) {
      <p
        class="m-0 grid min-h-dvh place-items-center text-small text-muted"
        role="status"
        data-testid="opening"
      >
        Opening the shared link…
      </p>
    }
  `,
})
export class OpenLinkPageComponent {
  private readonly creations = inject(CreationsService);
  private readonly handoff = inject(WorkingCopyHandoff);
  private readonly showHandoff = inject(ShowWorkingCopyHandoff);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  private readonly opened = signal<OpenedCreation | null>(null);
  protected readonly showOpening = signal(false);
  protected readonly message = computed<LinkMessage | null>(() => {
    const opened = this.opened();
    return opened ? messageFor(opened) : null;
  });

  private request: Subscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The route's `:shareCode`, checked against the §9 pattern before any request (Boo C4). */
  private code = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      if (this.timer) clearTimeout(this.timer);
    });
    // The component is reused when only the code changes (`/c/a` → `/c/b`), so follow the param.
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.code = params.get('shareCode') ?? '';
        this.load();
      });
  }

  protected act(action: LinkAction): void {
    if (action === 'retry') this.load();
    else if (action === 'reload') location.reload();
    else if (action === 'builder') void this.router.navigateByUrl('/show', { replaceUrl: true });
    else void this.router.navigateByUrl('/', { replaceUrl: true });
  }

  private load(): void {
    this.opened.set(null);
    this.showOpening.set(false);
    this.title.setTitle(SITE_TITLE);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.showOpening.set(true), OPENING_DELAY_MS);
    this.request?.unsubscribe();
    this.request = openCreation(this.creations, this.code).subscribe((opened) => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (opened.status === 'shell') {
        this.handoff.offer({
          shell: editableFrom(opened.shell, DEFAULT_SKY),
          source: sourceFrom(opened.response),
        });
        void this.router.navigateByUrl('/', { replaceUrl: true });
        return;
      }
      if (opened.status === 'show') {
        // A show opens in the Show Builder (schema.md §11.1, phase-6.md §2); the designer draft
        // is never touched.
        this.showHandoff.offer({ show: opened.show, source: sourceFrom(opened.response) });
        void this.router.navigateByUrl('/show', { replaceUrl: true });
        return;
      }
      this.opened.set(opened);
      this.title.setTitle(messageFor(opened).title);
    });
  }
}

function messageFor(opened: OpenedCreation): LinkMessage {
  switch (opened.status) {
    case 'not-found':
      return notFoundMessage('copy');
    case 'newer':
      return newerVersionMessage('copy', opened.kind);
    case 'network':
      return loadFailureMessage('copy', 'network', '');
    case 'rate-limited':
      return loadFailureMessage('copy', 'rate-limited', retryWhen(opened.retryAfterSeconds));
    case 'server':
      return loadFailureMessage('copy', 'server', '');
    case 'invalid':
      return invalidMessage('copy', opened.kind);
    default:
      return invalidMessage('copy');
  }
}

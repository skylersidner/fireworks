import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { notFoundMessage, type LinkSurface } from '../../shared/link-copy';
import { MessagePageComponent } from '../../shared/message-page/message-page';

/**
 * A `/s/…` or `/c/…` path that isn't one share code (`/s`, `/s/a/b`): the same not-found page a
 * bad or unknown code gets (phase-5.md §9; Boo C12), instead of the `**` redirect swallowing it
 * (Peach N3). No request.
 */
@Component({
  selector: 'app-link-not-found-page',
  imports: [MessagePageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-message-page [heading]="message.heading" [body]="message.body">
      @for (a of message.actions; track a.action) {
        <button
          type="button"
          class="btn btn-primary"
          [attr.data-testid]="'message-' + a.action"
          (click)="home()"
        >
          {{ a.label }}
        </button>
      }
    </app-message-page>
  `,
})
export class LinkNotFoundPageComponent {
  private readonly router = inject(Router);
  protected readonly message = notFoundMessage(
    (inject(ActivatedRoute).snapshot.data['surface'] as LinkSurface | undefined) ?? 'player',
  );

  constructor() {
    inject(Title).setTitle(this.message.title);
  }

  protected home(): void {
    void this.router.navigateByUrl('/');
  }
}

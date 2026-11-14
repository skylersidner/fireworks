import { Injectable } from '@angular/core';
import type { WorkingCopy } from '../pages/designer-page/shell-designer.store';

/**
 * Carries a working copy from `/c/:code` to the designer it redirects to (schema.md §11.1). The
 * link page fetches, upgrades and normalizes, then `offer`s the copy and navigates to `/` with
 * `replaceUrl`; the designer page `take`s it once on construction and asks over shell or sky
 * changes there (phase-5.md §7.2: the confirm shows over the designer). Holds at most one copy, in
 * memory only: a reload after the redirect restores from the draft, never from here. No HTTP.
 */
@Injectable({
  providedIn: 'root',
})
export class WorkingCopyHandoff {
  private pending: WorkingCopy | null = null;

  offer(copy: WorkingCopy): void {
    this.pending = copy;
  }

  /** The offered copy, once. */
  take(): WorkingCopy | null {
    const copy = this.pending;
    this.pending = null;
    return copy;
  }
}

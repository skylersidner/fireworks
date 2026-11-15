import { Injectable } from '@angular/core';
import type { ShowDocument } from '../../../../engine/model/show';
import type { CreationSource } from '../../../core/creation-save';

/** A show opened through `/c/:code` (schema.md §11.2): exactly its saved document and source. */
export interface ShowWorkingCopy {
  readonly show: ShowDocument;
  readonly source: CreationSource;
}

/**
 * Carries a show working copy from `/c/:code` to the Show Builder at `/show` (schema.md §11.1),
 * as `WorkingCopyHandoff` does for shells: in memory, once. No HTTP.
 */
@Injectable({
  providedIn: 'root',
})
export class ShowWorkingCopyHandoff {
  private pending: ShowWorkingCopy | null = null;

  offer(copy: ShowWorkingCopy): void {
    this.pending = copy;
  }

  take(): ShowWorkingCopy | null {
    const copy = this.pending;
    this.pending = null;
    return copy;
  }
}

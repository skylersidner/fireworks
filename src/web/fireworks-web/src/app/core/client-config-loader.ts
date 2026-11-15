import { HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiService } from './api';
import { ClientConfigStore } from './client-config';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import type { ClientConfigResponse } from './models';

/**
 * Fetches `GET api/client-config` once at app init (app.config.ts, alongside `api/me`, without
 * blocking the first render) into ClientConfigStore. A failure keeps the defaults silently: no
 * banner and no toast (SUPPRESS_ERROR_TOAST), since playback works the same on the defaults. Only
 * this module reaches HTTP; the stage and the builder read ClientConfigStore.
 */
@Injectable({ providedIn: 'root' })
export class ClientConfigLoader {
  private readonly api = inject(ApiService);
  private readonly store = inject(ClientConfigStore);

  /** Completes once settled and never errors. */
  load(): Observable<void> {
    const context = new HttpContext().set(SUPPRESS_ERROR_TOAST, true);
    return this.api.get<ClientConfigResponse>('api/client-config', context).pipe(
      map((r) => this.store.setPlayback((r as Partial<ClientConfigResponse> | null)?.playback)),
      catchError(() => of(undefined)),
    );
  }
}

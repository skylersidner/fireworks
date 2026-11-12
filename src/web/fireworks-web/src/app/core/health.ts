import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** `GET /health/live`: text/plain `Healthy` from the API's MapHealthChecks. */
@Injectable({
  providedIn: 'root',
})
export class HealthService {
  private readonly httpClient = inject(HttpClient);
  readonly endpoint = `${environment.apiBaseUrl}/health/live`;

  getLiveness(): Observable<string> {
    return this.httpClient.get(this.endpoint, { responseType: 'text' });
  }
}

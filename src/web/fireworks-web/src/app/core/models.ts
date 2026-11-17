/**
 * Hand-written mirrors of the API's C# records (reference convention: no generated client).
 * Keep each in step with src/api/Fireworks.Api/Contracts/ApiContracts.cs and CreationContracts.cs
 * by hand, and flag any drift to Bowser. ASP.NET serializes camelCase.
 */

/**
 * `MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite,
 * string? SignedInWith)`. Anonymous is `null, null, false, false, null`. `signedInWith` is optional
 * here (absent reads as `null`; bowser-phase8-server-auth.md); the server always sends it.
 */
export interface MeResponse {
  userId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  canWrite: boolean;
  signedInWith?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Creations (src/api/Fireworks.Api/Contracts/CreationContracts.cs; schema.md §2). Documents are
// `unknown` on the way in: a fetched document is untrusted and always goes
// parse → upgrade → normalize before it is played or edited (schema.md §8.3).
// ---------------------------------------------------------------------------------------------

/** `CreationResponse.Kind` and `CreateCreationRequest.Kind`: exactly these two strings. */
export type CreationKind = 'shell' | 'show';

/**
 * `CreationResponse(string ShareCode, string Kind, string Name, int SchemaVersion,
 * JsonElement Document, bool IsOwner, string? RemixedFrom, DateTimeOffset CreatedAt,
 * DateTimeOffset UpdatedAt)`.
 *
 * - `document` comes back in Postgres `jsonb` key order (keys sorted by length, then bytes), not
 *   the order it was sent in (schema.md §1). Compare parsed values (`toEqual`, field reads), never
 *   `JSON.stringify` output or response text.
 * - `updatedAt` is an opaque token: compare strings for equality, never parsed `Date`s, which keep
 *   only milliseconds (schema.md §2.1).
 * - `remixedFrom` is always present; non-null only for the remix's owner while its source exists.
 */
export interface CreationResponse {
  shareCode: string;
  kind: CreationKind;
  name: string;
  schemaVersion: number;
  document: unknown;
  isOwner: boolean;
  remixedFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `CreationListItem(string ShareCode, string Kind, string Name, DateTimeOffset UpdatedAt, IReadOnlyList<string> Palette)`. */
export interface CreationListItem {
  shareCode: string;
  kind: CreationKind;
  name: string;
  updatedAt: string;
  /** Color names (never hex), at most 8, computed at write time (schema.md §2.2). */
  palette: string[];
}

/**
 * `CreationListPage(IReadOnlyList<CreationListItem> Items, int Page, int PageSize, int TotalCount)`.
 * `page` and `pageSize` are the server's effective (clamped) values, not the requested ones.
 */
export interface CreationListPage {
  items: CreationListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** `CreateCreationRequest(string Kind, JsonElement Document)`: `POST api/creations`. */
export interface CreateCreationRequest {
  kind: CreationKind;
  document: unknown;
}

/** `UpdateCreationRequest(JsonElement Document)`: `PUT api/creations/{code}`. No `kind` (a 400). */
export interface UpdateCreationRequest {
  document: unknown;
}

/** `RemixCreationRequest(JsonElement Document)`: `POST …/remix`. The edited working copy. */
export interface RemixCreationRequest {
  document: unknown;
}

/** `ValidationIssue(string Path, string Code, string Message)`. UIs build copy from `code`. */
export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * `ValidationErrorResponse(string Message, IReadOnlyList<ValidationIssue> Errors, bool Truncated)`:
 * the structured 400 (schema.md §2.4). At most 100 errors; `truncated` is true when there were more.
 */
export interface ValidationErrorResponse {
  message: string;
  errors: ValidationIssue[];
  truncated: boolean;
}

/**
 * `ClientPlaybackConfig(int SeekBudgetMs, int CatchingUpDelayMs, int CheckpointIntervalSeconds,
 * int CheckpointMemoryMiB, int WarmUpDelayMs)`: the playback knobs from the server's appsettings
 * (Skyler, 2026-11-15; `WarmUpDelayMs` 2026-11-17). The server validates the ranges at startup;
 * the client clamps again (core/client-config.ts), and a server without a field leaves its default.
 */
export interface ClientPlaybackConfig {
  seekBudgetMs: number;
  catchingUpDelayMs: number;
  checkpointIntervalSeconds: number;
  checkpointMemoryMiB: number;
  /** Quiet time (no edit, no seek) before the builder starts or restarts warm-up, 0..5000 ms. */
  warmUpDelayMs: number;
}

/** `LoginProviderConfig(string Id, string Name)`: today only `{ id: 'google', name: 'Google' }`. */
export interface LoginProviderConfig {
  id: string;
  name: string;
}

/**
 * `ClientConfigResponse(ClientPlaybackConfig Playback, IReadOnlyList<LoginProviderConfig>
 * LoginProviders)`: `GET api/client-config`, anonymous. `loginProviders` is optional here (absent
 * means `[]`); it is empty only in Development or Testing without a client (Boo A33).
 */
export interface ClientConfigResponse {
  playback: ClientPlaybackConfig;
  loginProviders?: LoginProviderConfig[];
}

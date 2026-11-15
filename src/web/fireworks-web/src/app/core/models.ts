/**
 * Hand-written mirrors of the API's C# records (reference convention: no generated client).
 * Keep each in step with src/api/Fireworks.Api/Contracts/ApiContracts.cs and CreationContracts.cs
 * by hand, and flag any drift to Bowser. ASP.NET serializes camelCase.
 */

/** `MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite)`. */
export interface MeResponse {
  userId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  canWrite: boolean;
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
 * `PlaybackClientConfig(int SeekBudgetMs, int CatchingUpDelayMs, int CheckpointIntervalSeconds,
 * int CheckpointMemoryMiB)`: the playback knobs from the server's appsettings (Skyler,
 * 2026-11-15). The server validates the ranges at startup; the client clamps again
 * (core/client-config.ts).
 */
export interface PlaybackClientConfig {
  seekBudgetMs: number;
  catchingUpDelayMs: number;
  checkpointIntervalSeconds: number;
  checkpointMemoryMiB: number;
}

/** `ClientConfigResponse(PlaybackClientConfig Playback)`: `GET api/client-config`, anonymous. */
export interface ClientConfigResponse {
  playback: PlaybackClientConfig;
}

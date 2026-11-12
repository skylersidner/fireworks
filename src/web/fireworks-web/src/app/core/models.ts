/**
 * Hand-written mirrors of the API's C# records (reference convention: no generated client).
 * Keep each in step with src/api/Fireworks.Api/Contracts/ApiContracts.cs by hand, and flag any
 * drift to Bowser. ASP.NET serializes camelCase.
 */

/** `MeResponse(Guid? UserId, string? DisplayName, bool IsAuthenticated, bool CanWrite)`. */
export interface MeResponse {
  userId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  canWrite: boolean;
}

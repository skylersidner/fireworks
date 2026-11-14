/**
 * A share code (schema.md §9): 8 characters of Base58 without `0`, `O`, `I`, `l`, case-sensitive.
 * The client checks it before fetching, as the server's route constraint does, so a malformed
 * code never costs a request and reads exactly like an unknown one (404). Pure, with no Angular
 * or HTTP import, so the designer's draft can check a stored `source` without pulling in the
 * HTTP client.
 */
export const SHARE_CODE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

export function isShareCode(value: unknown): value is string {
  return typeof value === 'string' && SHARE_CODE_PATTERN.test(value);
}

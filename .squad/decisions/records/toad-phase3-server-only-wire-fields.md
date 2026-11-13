# Server-only fixtures carry `contentType` and `byteMarkers`

**Author:** Toad · **Date:** 2026-11-13 · **Status:** proposed · **Extends:** `toad-phase3-shared-fixtures.md` item 3

## What

1. `schema/fixtures/server-only/*.json` is `{ description, body, status, errors?, contentType?, byteMarkers? }`. `status` is 400, 413 or 415. `errors` is present exactly for 400; `contentType` exactly for 415.
2. **415 is a fixture, not a harness-only case.** `wrong-content-type.json` has `contentType: "text/plain"`; the harness sends `application/json` unless a fixture says otherwise.
3. **`byteMarkers`** maps an ASCII marker in `body` to hex bytes. The harness UTF-8-encodes `body` and replaces each marker's bytes. `not-utf8.json` uses `@@byte:ff@@` → `0xFF`. The fixture file stays valid UTF-8 and valid JSON.
4. Duplicate keys stay plain text in `body`. The harness must send `body`'s bytes as read, never re-serialized through a JSON DOM.
5. The format spec (`schema-fixtures-format.spec.ts`) checks each of these: the body with markers parses and the built bytes are invalid UTF-8; `contentType` is never `application/json`; the names repeated in each body are exactly the `duplicate-key` paths' last names; every body is well-formed Unicode (C# `GetString` throws otherwise).

## Why

- One folder the harness iterates is one place a wire case can't be forgotten, and the format spec can check a field but can't check a harness `[Fact]`.
- A raw `0xFF` can't live in a JSON string, and a file that isn't valid UTF-8 breaks both readers. A marker keeps the file readable and the defect exact (the negative control with the byte set to `0x41` is caught).

## Boundary

Binds Bowser's Phase 4 `CreationApiHarness` (how to build each request) and anyone adding a server-only fixture. schema.md §12.4 left the 415 shape and the marker to Toad; Yoshi may fold this into §12.4.

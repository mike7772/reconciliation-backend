/**
 * Opaque cursor encoding for keyset (not offset) pagination. Encodes an
 * ordered tuple of sort-key values (e.g. [lineNumber, id]) so callers can
 * resume a "WHERE (col1, col2) > (last1, last2)" style query without
 * exposing the underlying columns to clients.
 */
export function encodeCursor(parts: Array<string | number>): string {
  return Buffer.from(parts.join(":")).toString("base64url");
}

export function decodeCursor(cursor: string): string[] {
  return Buffer.from(cursor, "base64url").toString("utf8").split(":");
}

import { Readable } from "stream";

export interface ParsedLine {
  lineNumber: number;
  raw: string;
  /** Absolute byte offset into the whole file, immediately after this line. */
  byteOffsetAfter: number;
  /** True if the line exceeded MAX_LINE_BYTES before a newline was found. */
  oversized: boolean;
}

// A single malformed/adversarial line must never grow the in-memory buffer
// without bound - cap it and yield what we have as an oversized line rather
// than waiting indefinitely for a newline that may never arrive.
export const MAX_LINE_BYTES = 1_000_000;

const NEWLINE = 0x0a;

/**
 * Splits an NDJSON byte stream into lines without ever buffering more than
 * one line (or MAX_LINE_BYTES, whichever is smaller) at a time. Splitting on
 * the raw 0x0A byte is UTF-8-safe: continuation bytes in multi-byte
 * sequences are always >= 0x80, so 0x0A can only ever be a real newline.
 *
 * `startByteOffset`/`startLineNumber` let processing resume mid-file after a
 * crash, using MinIO's ranged GET on the caller's side to avoid re-reading
 * already-processed bytes.
 */
export async function* parseNdjsonLines(
  stream: Readable,
  startByteOffset = 0,
  startLineNumber = 0
): AsyncGenerator<ParsedLine> {
  let buffer = Buffer.alloc(0);
  let byteOffset = startByteOffset;
  let lineNumber = startLineNumber;

  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    let newlineIndex = buffer.indexOf(NEWLINE);
    while (newlineIndex !== -1) {
      const lineBuf = buffer.subarray(0, newlineIndex);
      buffer = buffer.subarray(newlineIndex + 1);
      byteOffset += newlineIndex + 1;
      lineNumber += 1;

      yield {
        lineNumber,
        raw: stripTrailingCr(lineBuf).toString("utf8"),
        byteOffsetAfter: byteOffset,
        oversized: false,
      };

      newlineIndex = buffer.indexOf(NEWLINE);
    }

    if (buffer.length > MAX_LINE_BYTES) {
      lineNumber += 1;
      byteOffset += buffer.length;
      yield {
        lineNumber,
        raw: buffer.toString("utf8", 0, MAX_LINE_BYTES),
        byteOffsetAfter: byteOffset,
        oversized: true,
      };
      buffer = Buffer.alloc(0);
    }
  }

  // Final line with no trailing newline.
  if (buffer.length > 0) {
    lineNumber += 1;
    byteOffset += buffer.length;
    yield {
      lineNumber,
      raw: stripTrailingCr(buffer).toString("utf8"),
      byteOffsetAfter: byteOffset,
      oversized: buffer.length > MAX_LINE_BYTES,
    };
  }
}

function stripTrailingCr(buf: Buffer): Buffer {
  if (buf.length > 0 && buf[buf.length - 1] === 0x0d) {
    return buf.subarray(0, buf.length - 1);
  }
  return buf;
}

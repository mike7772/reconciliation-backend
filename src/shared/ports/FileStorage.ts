import { Readable } from "stream";

export interface StoredFileInfo {
  bucket: string;
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface FileStorage {
  /** Streams `stream` to storage under `key` without buffering it fully in memory. */
  store(key: string, stream: Readable): Promise<StoredFileInfo>;

  /** Reads storage back as a stream, optionally resuming from a byte offset. */
  read(key: string, startOffset?: number): Promise<Readable>;
}

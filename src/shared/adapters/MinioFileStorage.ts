import { Client } from "minio";
import { PassThrough, Readable } from "stream";
import { FileStorage, StoredFileInfo } from "../ports/FileStorage";

export class MinioFileStorage implements FileStorage {
  constructor(
    private readonly client: Client,
    private readonly bucket: string
  ) {}

  async store(key: string, stream: Readable): Promise<StoredFileInfo> {
    let sizeBytes = 0;
    const counting = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      sizeBytes += chunk.length;
    });
    stream.pipe(counting);

    // putObject is called without a known size, so the MinIO SDK streams it
    // as a multipart upload rather than requiring the caller to buffer the
    // whole file to measure it upfront.
    const result = await this.client.putObject(this.bucket, key, counting);

    return {
      bucket: this.bucket,
      key,
      sizeBytes,
      checksum: result.etag,
    };
  }

  async read(key: string, startOffset = 0): Promise<Readable> {
    return this.client.getPartialObject(this.bucket, key, startOffset);
  }
}

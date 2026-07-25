export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

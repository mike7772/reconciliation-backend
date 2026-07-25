export interface RetryPolicy {
  /**
   * Runs `fn`, retrying on failure only while `isRetryable(err)` is true and
   * the attempt limit hasn't been reached. `shouldAbort`, if given, is
   * checked between attempts (not mid-backoff) so a cancelled operation
   * doesn't keep retrying a doomed call - it's optional because most
   * callers don't have a cancellation signal to offer.
   */
  execute<T>(
    operationName: string,
    fn: () => Promise<T>,
    isRetryable: (err: unknown) => boolean,
    shouldAbort?: () => Promise<boolean>
  ): Promise<T>;
}

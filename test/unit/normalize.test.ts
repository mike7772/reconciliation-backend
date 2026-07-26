import { normalizeRecord } from "../../src/shared/utils/normalize";

describe("normalizeRecord", () => {
  it("trims whitespace from string fields", () => {
    const result = normalizeRecord({
      transactionId: "  txn-1  ",
      accountId: " acc-1 ",
      merchantId: " merchant-1 ",
      amount: 10,
      currency: "usd",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: "  hello  ",
    });

    expect(result.transactionId).toBe("txn-1");
    expect(result.accountId).toBe("acc-1");
    expect(result.merchantId).toBe("merchant-1");
    expect(result.description).toBe("hello");
  });

  it("uppercases and trims the currency code", () => {
    const result = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "  usd ",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: undefined,
    });

    expect(result.currency).toBe("USD");
  });

  it("strips ASCII control characters from strings (log-injection defense)", () => {
    const result = normalizeRecord({
      transactionId: "txn-1\n\rmalicious",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: undefined,
    });

    expect(result.transactionId).toBe("txn-1malicious");
  });

  it("normalizes different representations of the same instant to the same canonical string", () => {
    const withMillis = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: undefined,
    });
    const withOffset = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "2026-07-20T10:00:00+00:00",
      description: undefined,
    });

    expect(withMillis.timestamp).toBe(withOffset.timestamp);
  });

  it("returns undefined for a timestamp that isn't strict ISO-8601", () => {
    const result = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "07/20/2026",
      description: undefined,
    });

    expect(result.timestamp).toBeUndefined();
  });

  it("truncates description to the maximum allowed length", () => {
    const longDescription = "x".repeat(600);
    const result = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: longDescription,
    });

    expect((result.description as string).length).toBe(500);
  });

  it("drops fields not part of the expected shape", () => {
    const result = normalizeRecord({
      transactionId: "t",
      accountId: "a",
      merchantId: "m",
      amount: 1,
      currency: "USD",
      timestamp: "2026-07-20T10:00:00.000Z",
      description: undefined,
      __proto__: "polluted",
      unexpectedField: "should not appear",
    } as unknown as Record<string, unknown>);

    expect(Object.keys(result).sort()).toEqual(
      ["accountId", "amount", "currency", "description", "merchantId", "timestamp", "transactionId"].sort()
    );
  });
});

import { transactionSchema } from "../../src/modules/imports/imports.validation";

const validRecord = {
  transactionId: "txn-10001",
  accountId: "acc-201",
  merchantId: "merchant-18",
  amount: 145.75,
  currency: "USD",
  timestamp: "2026-07-20T10:25:00.000Z",
  description: "Subscription payment",
};

describe("transactionSchema", () => {
  it("accepts a fully valid record", () => {
    const result = transactionSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it("accepts a record without the optional description", () => {
    const { description, ...withoutDescription } = validRecord;
    const result = transactionSchema.safeParse(withoutDescription);
    expect(result.success).toBe(true);
  });

  it("rejects a record missing a required field", () => {
    const { merchantId, ...missingMerchant } = validRecord;
    const result = transactionSchema.safeParse(missingMerchant);
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(transactionSchema.safeParse({ ...validRecord, amount: 0 }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...validRecord, amount: -5 }).success).toBe(false);
  });

  it("rejects a currency code that isn't three uppercase letters", () => {
    expect(transactionSchema.safeParse({ ...validRecord, currency: "us" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...validRecord, currency: "usd" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...validRecord, currency: "US1" }).success).toBe(false);
  });

  it("rejects an unsupported (but well-formed) currency code", () => {
    const result = transactionSchema.safeParse({ ...validRecord, currency: "ZZZ" });
    expect(result.success).toBe(false);
  });

  it("rejects a description longer than the maximum allowed length", () => {
    const result = transactionSchema.safeParse({ ...validRecord, description: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts a description at exactly the maximum allowed length", () => {
    const result = transactionSchema.safeParse({ ...validRecord, description: "x".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("rejects a non-string, non-numeric amount", () => {
    const result = transactionSchema.safeParse({ ...validRecord, amount: "145.75" });
    expect(result.success).toBe(false);
  });
});

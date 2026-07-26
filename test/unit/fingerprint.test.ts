import { calculateFingerprint, FingerprintFields } from "../../src/shared/utils/fingerprint";

const baseTransaction: FingerprintFields = {
  transactionId: "txn-1",
  accountId: "acc-1",
  merchantId: "merchant-1",
  amount: 100,
  currency: "USD",
  timestamp: "2026-07-20T10:00:00.000Z",
};

describe("calculateFingerprint", () => {
  it("is deterministic for identical input", () => {
    expect(calculateFingerprint(baseTransaction)).toBe(calculateFingerprint({ ...baseTransaction }));
  });

  it("produces a 64-character hex sha256 digest", () => {
    const fingerprint = calculateFingerprint(baseTransaction);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any included field changes", () => {
    const base = calculateFingerprint(baseTransaction);

    expect(calculateFingerprint({ ...baseTransaction, transactionId: "txn-2" })).not.toBe(base);
    expect(calculateFingerprint({ ...baseTransaction, accountId: "acc-2" })).not.toBe(base);
    expect(calculateFingerprint({ ...baseTransaction, merchantId: "merchant-2" })).not.toBe(base);
    expect(calculateFingerprint({ ...baseTransaction, amount: 100.01 })).not.toBe(base);
    expect(calculateFingerprint({ ...baseTransaction, currency: "EUR" })).not.toBe(base);
    expect(calculateFingerprint({ ...baseTransaction, timestamp: "2026-07-20T10:00:01.000Z" })).not.toBe(
      base
    );
  });

  it("is not affected by the description field, since it is deliberately excluded", () => {
    const withDescription = { ...baseTransaction, description: "some free text" } as FingerprintFields & {
      description: string;
    };

    expect(calculateFingerprint(withDescription)).toBe(calculateFingerprint(baseTransaction));
  });

  it("treats amounts differing only beyond 2 decimal places as identical (fixed 2dp representation)", () => {
    expect(calculateFingerprint({ ...baseTransaction, amount: 100.001 })).toBe(
      calculateFingerprint({ ...baseTransaction, amount: 100.004 })
    );
  });
});

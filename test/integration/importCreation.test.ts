import request from "supertest";
import { buildTestApp, cleanDatabase, disconnectTestPrisma, signTestToken, TestApp } from "./helpers";

describe("Import creation (integration)", () => {
  let testApp: TestApp;
  const token = signTestToken();

  beforeEach(async () => {
    await cleanDatabase();
    testApp = buildTestApp();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestPrisma();
  });

  it("rejects a request without an Idempotency-Key header", async () => {
    const res = await request(testApp.app)
      .post("/v1/imports")
      .set("Authorization", `Bearer ${token}`)
      .field("providerId", "provider-1")
      .attach("file", Buffer.from('{"a":1}\n'), "file.ndjson");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects a request without a bearer token", async () => {
    const res = await request(testApp.app)
      .post("/v1/imports")
      .set("Idempotency-Key", "key-no-auth")
      .field("providerId", "provider-1")
      .attach("file", Buffer.from('{"a":1}\n'), "file.ndjson");

    expect(res.status).toBe(401);
  });

  it("returns 202 and persists a pending import for a valid request", async () => {
    const res = await request(testApp.app)
      .post("/v1/imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "key-create-1")
      .field("providerId", "provider-1")
      .attach("file", Buffer.from('{"transactionId":"t1"}\n'), "file.ndjson");

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    expect(res.body.id).toBeDefined();
    expect(testApp.jobQueue.enqueued).toEqual([res.body.id]);

    const persisted = await testApp.importService.getImport(res.body.id);
    expect(persisted.idempotencyKey).toBe("key-create-1");
    expect(persisted.providerId).toBe("provider-1");
  });

  it("rejects an unsupported file extension", async () => {
    const res = await request(testApp.app)
      .post("/v1/imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "key-bad-ext")
      .field("providerId", "provider-1")
      .attach("file", Buffer.from("not ndjson"), "file.csv");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("returns the same import when the same Idempotency-Key is repeated (idempotent creation)", async () => {
    const first = await request(testApp.app)
      .post("/v1/imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "key-repeat")
      .field("providerId", "provider-1")
      .attach("file", Buffer.from('{"transactionId":"t1"}\n'), "file.ndjson");

    const second = await request(testApp.app)
      .post("/v1/imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "key-repeat")
      .field("providerId", "provider-1")
      .attach("file", Buffer.from('{"transactionId":"t1"}\n'), "file.ndjson");

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
    // Second request never reached the file-upload path - only one job enqueued.
    expect(testApp.jobQueue.enqueued).toEqual([first.body.id]);
  });

  it("does not create a second import when concurrent requests share the same Idempotency-Key", async () => {
    const key = "key-concurrent";
    const makeRequest = () =>
      request(testApp.app)
        .post("/v1/imports")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .field("providerId", "provider-1")
        .attach("file", Buffer.from('{"transactionId":"t1"}\n'), "file.ndjson");

    const [a, b, c] = await Promise.all([makeRequest(), makeRequest(), makeRequest()]);

    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]);
    const ids = new Set([a.body.id, b.body.id, c.body.id]);
    expect(ids.size).toBe(1);

    const count = await testApp.importService
      .getImport(a.body.id)
      .then(() => 1)
      .catch(() => 0);
    expect(count).toBe(1);
  });
});

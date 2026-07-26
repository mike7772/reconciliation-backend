import { z } from "../../shared/validation/zod";
import registry, { BEARER_AUTH } from "../../config/openapi/registry";
import {
  importResponseSchema,
  importStatusResponseSchema,
  errorResponseSchema,
  summaryResponseSchema,
  rejectionsResponseSchema,
} from "./imports.validation";

registry.registerPath({
  method: "post",
  path: "/v1/imports",
  tags: ["Imports"],
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    headers: z.object({
      "Idempotency-Key": z.string().describe("Required. Repeating the same key returns the existing import."),
    }),
  },
  responses: {
    202: {
      description: "Import accepted (or already exists for this idempotency key)",
      content: { "application/json": { schema: importResponseSchema } },
    },
    400: {
      description: "Missing Idempotency-Key, providerId, or file part",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    413: {
      description: "Uploaded file exceeds the allowed size",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    415: {
      description: "Unsupported content type or file extension",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/imports/{id}",
  tags: ["Imports"],
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Import status and progress",
      content: { "application/json": { schema: importStatusResponseSchema } },
    },
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Import not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/imports/{id}/cancel",
  tags: ["Imports"],
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Cancellation requested (or import was already in a terminal state)",
      content: { "application/json": { schema: z.object({ id: z.string(), status: z.string() }) } },
    },
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Import not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/imports/{id}/summary",
  tags: ["Imports"],
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Reconciliation summary based on persisted processing results",
      content: { "application/json": { schema: summaryResponseSchema } },
    },
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Import not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/imports/{id}/rejections",
  tags: ["Imports"],
  security: [{ [BEARER_AUTH]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      limit: z.string().optional().describe("Default 50, max 200"),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Cursor-paginated rejected records",
      content: { "application/json": { schema: rejectionsResponseSchema } },
    },
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "Import not found",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

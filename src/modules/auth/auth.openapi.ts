import { z } from "../../shared/utils/zod";
import registry, { BEARER_AUTH } from "../../config/openapi/registry";
import { registerSchema, loginSchema } from "./auth.validation";

const BASE_API_PATH = "/api";

registry.registerPath({
  method: "post",
  path: `${BASE_API_PATH}/auth/register`,
  tags: ["Auth"],
  security: [],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: registerSchema,
          example: {
            name: "Jane Doe",
            email: "jane@example.com",
            password: "password123",
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Registered successfully",
      content: { "application/json": { schema: z.object({}) } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: z.object({}) } },
    },
    409: {
      description: "Email already registered",
      content: { "application/json": { schema: z.object({}) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: `${BASE_API_PATH}/auth/login`,
  tags: ["Auth"],
  security: [],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: loginSchema,
          example: {
            email: "jane@example.com",
            password: "password123",
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Logged in successfully",
      content: { "application/json": { schema: z.object({}) } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: z.object({}) } },
    },
    401: {
      description: "Invalid credentials",
      content: { "application/json": { schema: z.object({}) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: `${BASE_API_PATH}/auth/me`,
  tags: ["Auth"],
  security: [{ [BEARER_AUTH]: [] }],
  responses: {
    200: {
      description: "Current authenticated user",
      content: { "application/json": { schema: z.object({}) } },
    },
    401: {
      description: "Missing or invalid token",
      content: { "application/json": { schema: z.object({}) } },
    },
  },
});

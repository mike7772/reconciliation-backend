import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

const registry = new OpenAPIRegistry();

export const BEARER_AUTH = "bearerAuth";

registry.registerComponent("securitySchemes", BEARER_AUTH, {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export default registry;

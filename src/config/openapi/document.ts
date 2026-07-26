import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import registry from "./registry";

// Side-effect imports: each module's *.openapi.ts registers its paths onto
// the shared registry above. Add new modules here as they're built.
import "../../modules/auth/auth.openapi";
import "../../modules/imports/imports.openapi";
import "../../modules/health/health.openapi";

export default function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "Reconciliation System API",
      version: "1.0.0",
      description: "Reconciliation System API documentation",
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 4000}` }],
  });
}

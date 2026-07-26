import { z } from "../../shared/validation/zod";
import registry from "../../config/openapi/registry";

registry.registerPath({
  method: "get",
  path: "/health/live",
  tags: ["Health"],
  security: [],
  description: "Liveness check - confirms the process is running and responding. Does not check dependencies.",
  responses: {
    200: {
      description: "Process is alive",
      content: { "application/json": { schema: z.object({ status: z.literal("alive") }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/ready",
  tags: ["Health"],
  security: [],
  description:
    "Readiness check - confirms the process can accept traffic and reach its critical dependencies. Postgres is required for readiness; Redis/MinIO are reported but don't flip overall status.",
  responses: {
    200: {
      description: "Ready to accept traffic",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ready"),
            checks: z.object({ postgres: z.boolean(), redis: z.boolean(), minio: z.boolean() }),
          }),
        },
      },
    },
    503: {
      description: "Not ready (Postgres unreachable, or the process is shutting down)",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("not_ready"),
            reason: z.string().optional(),
            checks: z
              .object({ postgres: z.boolean(), redis: z.boolean(), minio: z.boolean() })
              .optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/metrics",
  tags: ["Health"],
  security: [],
  description: "Prometheus-format metrics for the API server process (see the worker's own :9465/metrics for worker-side metrics).",
  responses: {
    200: {
      description: "Prometheus text-format metrics",
      content: { "text/plain": { schema: z.string() } },
    },
  },
});

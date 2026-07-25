import { z } from "../../shared/utils/zod";

export const providerIdSchema = z.string().min(1).max(200);

export const importResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed", "cancelling", "cancelled"]),
  createdAt: z.string(),
});

export const importStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed", "cancelling", "cancelled"]),
  progress: z.object({
    processed: z.number(),
    accepted: z.number(),
    rejected: z.number(),
    duplicates: z.number(),
  }),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

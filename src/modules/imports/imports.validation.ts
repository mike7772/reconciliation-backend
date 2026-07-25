import { z } from "../../shared/validation/zod";
import { SUPPORTED_CURRENCIES } from "../../shared/constants/currencies";
import { MAX_DESCRIPTION_LENGTH } from "../../shared/utils/normalize";

const MAX_ID_LENGTH = 200;

export const transactionSchema = z.object({
  transactionId: z.string().min(1).max(MAX_ID_LENGTH),
  accountId: z.string().min(1).max(MAX_ID_LENGTH),
  merchantId: z.string().min(1).max(MAX_ID_LENGTH),
  amount: z.number().finite().positive(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code")
    .refine((code) => SUPPORTED_CURRENCIES.has(code), {
      message: "Currency must be a supported code",
    }),
  timestamp: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
});

export type Transaction = z.infer<typeof transactionSchema>;

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

export const summaryResponseSchema = z.object({
  importId: z.string(),
  totals: z.object({
    accepted: z.number(),
    rejected: z.number(),
    duplicates: z.number(),
  }),
  byCurrency: z.array(
    z.object({
      currency: z.string(),
      transactionCount: z.number(),
      totalAmount: z.number(),
    })
  ),
  byRiskLevel: z.object({
    low: z.number(),
    medium: z.number(),
    high: z.number(),
  }),
});

export const rejectionsResponseSchema = z.object({
  items: z.array(
    z.object({
      lineNumber: z.number(),
      reason: z.string(),
      message: z.string(),
      rawValue: z.unknown(),
    })
  ),
  nextCursor: z.string().nullable(),
});

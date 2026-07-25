import { z } from "../../../../shared/utils/zod";
import { SUPPORTED_CURRENCIES } from "./currencies";
import { MAX_DESCRIPTION_LENGTH } from "./normalize";

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

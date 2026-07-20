import { z } from 'zod';

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().positive().max(100)
      })
    )
    .min(1)
});

export type CreateOrderPayload = z.infer<typeof createOrderSchema>;
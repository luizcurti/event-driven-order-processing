import { z } from 'zod';

import { ValidationError } from '../errors/app-errors';

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
    .max(50)
});

export type CreateOrderPayload = z.infer<typeof createOrderSchema>;

/**
 * Parses and validates a create-order request body, converting both malformed
 * JSON and schema violations into a ValidationError so callers get a
 * consistent 400 response instead of leaking a raw ZodError/SyntaxError.
 */
export const parseCreateOrderPayload = (
  rawBody: string
): CreateOrderPayload => {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }

  const result = createOrderSchema.safeParse(parsedJson);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');

    throw new ValidationError(message);
  }

  return result.data;
};

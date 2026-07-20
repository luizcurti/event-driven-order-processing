import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { randomUUID } from 'node:crypto';

export const getCorrelationId = (event?: APIGatewayProxyEventV2): string => {
  const headerValue = event?.headers?.['x-correlation-id'] ?? event?.headers?.['X-Correlation-Id'];

  return headerValue?.trim() || randomUUID();
};

export const getIdempotencyKey = (event?: APIGatewayProxyEventV2): string => {
  const headerValue = event?.headers?.['idempotency-key'] ?? event?.headers?.['Idempotency-Key'];

  return headerValue?.trim() || randomUUID();
};
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { CreateOrderUseCase } from '../application/create-order';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';
import { ValidationError } from '../../shared/errors/app-errors';
import { jsonResponse, withHttpHandler } from '../../shared/utils/http';
import { getIdempotencyKey } from '../../shared/utils/correlation';
import { createOrderSchema } from '../../shared/validation/order-schema';

const logger = createLogger('create-order');
const useCase = new CreateOrderUseCase(
  createOrderRepository(),
  createEventPublisher(),
  logger
);

const parseBody = (event: APIGatewayProxyEventV2) => {
  if (!event.body) {
    throw new ValidationError('Request body is required.');
  }

  return createOrderSchema.parse(JSON.parse(event.body));
};

export const handler = withHttpHandler(
  logger,
  'create order',
  async (event, correlationId) => {
    const payload = parseBody(event);
    const result = await useCase.execute({
      ...payload,
      correlationId,
      idempotencyKey: getIdempotencyKey(event)
    });

    return jsonResponse(result.reused ? 200 : 202, {
      orderId: result.orderId,
      status: result.status
    });
  }
);

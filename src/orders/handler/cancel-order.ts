import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { createLogger, createOrderRepository } from '../../shared/infrastructure/factory';
import { errorResponse, jsonResponse } from '../../shared/utils/http';
import { getCorrelationId } from '../../shared/utils/correlation';
import { ValidationError } from '../../shared/errors/app-errors';
import { CancelOrderUseCase } from '../application/cancel-order';

const logger = createLogger('cancel-order');
const useCase = new CancelOrderUseCase(createOrderRepository());

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const correlationId = getCorrelationId(event);
  const orderId = event.pathParameters?.id;

  logger.addContext({ correlationId, requestId: event.requestContext.requestId ?? 'unknown' });

  try {
    if (!orderId) {
      throw new ValidationError('Order id is required.');
    }

    const order = await useCase.execute(orderId);

    return jsonResponse(200, order);
  } catch (error) {
    logger.error('Failed to cancel order.', { correlationId, error: error instanceof Error ? error.message : 'unknown' });
    return errorResponse(error);
  }
};
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import {
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';
import { jsonResponse, errorResponse } from '../../shared/utils/http';
import { getCorrelationId } from '../../shared/utils/correlation';
import { ListOrdersUseCase } from '../application/list-orders';

const logger = createLogger('list-orders');
const useCase = new ListOrdersUseCase(createOrderRepository());

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const correlationId = getCorrelationId(event);
  logger.addContext({
    correlationId,
    requestId: event.requestContext.requestId ?? 'unknown'
  });

  try {
    const orders = await useCase.execute();
    return jsonResponse(200, orders);
  } catch (error) {
    logger.error('Failed to list orders.', {
      correlationId,
      error: error instanceof Error ? error.message : 'unknown'
    });
    return errorResponse(error);
  }
};

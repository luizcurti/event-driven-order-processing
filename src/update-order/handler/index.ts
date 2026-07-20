import type { Handler } from 'aws-lambda';

import { UpdateOrderStatusUseCase } from '../application/update-order-status';
import { createLogger, createOrderRepository } from '../../shared/infrastructure/factory';

interface UpdateOrderEvent {
  orderId: string;
  status: 'APPROVED' | 'REJECTED' | 'OUT_OF_STOCK' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
  correlationId: string;
}

const logger = createLogger('update-order');
const useCase = new UpdateOrderStatusUseCase(createOrderRepository());

export const handler: Handler<UpdateOrderEvent, unknown> = async (event) => {
  logger.addContext({ correlationId: event.correlationId, orderId: event.orderId });
  return useCase.execute(event.orderId, event.status);
};
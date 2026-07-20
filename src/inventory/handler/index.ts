import type { Handler } from 'aws-lambda';

import { CheckInventoryUseCase } from '../application/check-inventory';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';

interface InventoryEvent {
  orderId: string;
  correlationId: string;
}

const logger = createLogger('inventory');
const useCase = new CheckInventoryUseCase(
  createOrderRepository(),
  createEventPublisher(),
  {
    inventoryCheckEnabled: process.env.FEATURE_INVENTORY_CHECK !== 'false',
    fraudCheckEnabled: process.env.FEATURE_FRAUD_CHECK !== 'false'
  },
  logger
);

export const handler: Handler<InventoryEvent, unknown> = async (event) => {
  logger.addContext({
    correlationId: event.correlationId,
    orderId: event.orderId
  });
  return useCase.execute(event.orderId, event.correlationId);
};

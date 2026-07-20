import type { Handler } from 'aws-lambda';

import { CheckFraudUseCase } from '../application/check-fraud';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';

interface FraudEvent {
  orderId: string;
  correlationId: string;
}

const logger = createLogger('fraud');
const useCase = new CheckFraudUseCase(
  createOrderRepository(),
  createEventPublisher(),
  {
    inventoryCheckEnabled: process.env.FEATURE_INVENTORY_CHECK !== 'false',
    fraudCheckEnabled: process.env.FEATURE_FRAUD_CHECK !== 'false'
  },
  logger
);

export const handler: Handler<FraudEvent, unknown> = async (event) => {
  logger.addContext({
    correlationId: event.correlationId,
    orderId: event.orderId
  });
  return useCase.execute(event.orderId, event.correlationId);
};

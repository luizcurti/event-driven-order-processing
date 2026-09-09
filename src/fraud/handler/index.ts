import { CheckFraudUseCase } from '../application/check-fraud';
import {
  createEventPublisher,
  createFeatureFlags,
  createLogger,
  createOrderRepository,
  createStepHandler
} from '../../shared/infrastructure/factory';

const logger = createLogger('fraud');
const useCase = new CheckFraudUseCase(
  createOrderRepository(),
  createEventPublisher(),
  createFeatureFlags(),
  logger
);

export const handler = createStepHandler(
  'fraud',
  logger,
  (orderId, correlationId) => useCase.execute(orderId, correlationId)
);

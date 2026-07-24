import { CheckInventoryUseCase } from '../application/check-inventory';
import {
  createEventPublisher,
  createFeatureFlags,
  createLogger,
  createOrderRepository,
  createStepHandler
} from '../../shared/infrastructure/factory';

const logger = createLogger('inventory');
const useCase = new CheckInventoryUseCase(
  createOrderRepository(),
  createEventPublisher(),
  createFeatureFlags(),
  logger
);

export const handler = createStepHandler(logger, (orderId, correlationId) =>
  useCase.execute(orderId, correlationId)
);

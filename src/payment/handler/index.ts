import { ProcessPaymentUseCase } from '../application/process-payment';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository,
  createStepHandler
} from '../../shared/infrastructure/factory';

const logger = createLogger('payment');
const useCase = new ProcessPaymentUseCase(
  createOrderRepository(),
  createEventPublisher(),
  logger
);

export const handler = createStepHandler(
  'payment',
  logger,
  (orderId, correlationId) => useCase.execute(orderId, correlationId)
);

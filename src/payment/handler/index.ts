import type { Handler } from 'aws-lambda';

import { ProcessPaymentUseCase } from '../application/process-payment';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';

interface PaymentEvent {
  orderId: string;
  correlationId: string;
}

const logger = createLogger('payment');
const useCase = new ProcessPaymentUseCase(
  createOrderRepository(),
  createEventPublisher(),
  logger
);

export const handler: Handler<PaymentEvent, unknown> = async (event) => {
  logger.addContext({
    correlationId: event.correlationId,
    orderId: event.orderId
  });
  return useCase.execute(event.orderId, event.correlationId);
};

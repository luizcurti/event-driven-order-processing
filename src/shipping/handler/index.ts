import type { SQSHandler } from 'aws-lambda';

import { ProcessShippingUseCase } from '../application/process-shipping';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';
import { withInvocationMetrics } from '../../shared/infrastructure/metrics';

const logger = createLogger('shipping');
const useCase = new ProcessShippingUseCase(
  createOrderRepository(),
  createEventPublisher(),
  logger
);

export const handler: SQSHandler = withInvocationMetrics(
  'shipping',
  async (event) => {
    await useCase.execute(event);
  }
);

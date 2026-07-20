import type { SQSHandler } from 'aws-lambda';

import { ProcessShippingUseCase } from '../application/process-shipping';
import {
  createEventPublisher,
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';

const logger = createLogger('shipping');
const useCase = new ProcessShippingUseCase(
  createOrderRepository(),
  createEventPublisher(),
  logger
);

export const handler: SQSHandler = async (event) => {
  await useCase.execute(event);
};

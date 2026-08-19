import type { SQSHandler } from 'aws-lambda';

import { SendNotificationUseCase } from '../application/send-notification';
import { createLogger } from '../../shared/infrastructure/factory';
import { withInvocationMetrics } from '../../shared/infrastructure/metrics';

const logger = createLogger('notification');
const useCase = new SendNotificationUseCase(logger);

export const handler: SQSHandler = withInvocationMetrics(
  'notification',
  async (event) => {
    await useCase.execute(event);
  }
);

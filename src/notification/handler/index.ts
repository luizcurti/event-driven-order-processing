import type { SQSHandler } from 'aws-lambda';

import { SendNotificationUseCase } from '../application/send-notification';
import { createLogger } from '../../shared/infrastructure/factory';

const logger = createLogger('notification');
const useCase = new SendNotificationUseCase(logger);

export const handler: SQSHandler = async (event) => {
  await useCase.execute(event);
};

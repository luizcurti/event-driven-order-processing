import type { SQSEvent } from 'aws-lambda';

import type { StructuredLogger } from '../../shared/application/ports';

interface NotificationMessage {
  orderId: string;
  correlationId: string;
  channel?: 'email' | 'sms' | 'push';
  reason?: string;
}

const DEFAULT_CHANNEL = 'email';

export class SendNotificationUseCase {
  constructor(private readonly logger: StructuredLogger) {}

  execute(event: SQSEvent): Promise<void> {
    for (const record of event.Records) {
      const message = JSON.parse(record.body) as NotificationMessage;

      this.logger.addContext({
        correlationId: message.correlationId,
        orderId: message.orderId
      });
      this.logger.info('Notification dispatched.', {
        channel: message.channel ?? DEFAULT_CHANNEL,
        reason: message.reason ?? 'Order status changed.',
        status: 'SENT'
      });
    }

    return Promise.resolve();
  }
}

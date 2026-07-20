import type { SQSEvent } from 'aws-lambda';

import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type { EventEnvelope } from '../../shared/domain/order';
import type { OrderEventDetail } from '../../shared/domain/events';

interface ShippingMessage {
  orderId: string;
  correlationId: string;
}

export class ProcessShippingUseCase {
  constructor(
    private readonly repository: OrderRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: StructuredLogger
  ) {}

  async execute(event: SQSEvent): Promise<void> {
    for (const record of event.Records) {
      const message = JSON.parse(record.body) as ShippingMessage;
      await this.repository.updateStatus(message.orderId, 'SHIPPING');
      await this.eventPublisher.publish(
        this.buildEvent(
          'ShippingStarted',
          message.orderId,
          message.correlationId,
          'SHIPPING'
        )
      );

      await this.repository.updateStatus(message.orderId, 'DELIVERED');
      await this.eventPublisher.publish(
        this.buildEvent(
          'ShippingCompleted',
          message.orderId,
          message.correlationId,
          'DELIVERED'
        )
      );

      this.logger.info('Order prepared for shipment.', {
        orderId: message.orderId,
        correlationId: message.correlationId,
        status: 'DELIVERED'
      });
    }
  }

  private buildEvent(
    detailType: 'ShippingStarted' | 'ShippingCompleted',
    orderId: string,
    correlationId: string,
    status: 'SHIPPING' | 'DELIVERED'
  ): EventEnvelope<OrderEventDetail> {
    return {
      source: 'order.processing',
      detailType,
      version: 'v1',
      correlationId,
      timestamp: new Date().toISOString(),
      detail: {
        orderId,
        status
      }
    };
  }
}

import type { SQSEvent } from 'aws-lambda';

import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type { OrderEventDetail } from '../../shared/domain/order';

import { buildEventEnvelope } from '../../shared/domain/event-envelope';
import { OrderAlreadyFinalizedException } from '../../shared/errors/app-errors';

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

      try {
        await this.shipOrder(message);
      } catch (error) {
        if (!(error instanceof OrderAlreadyFinalizedException)) {
          throw error;
        }

        this.logger.info('Order was already finalized; skipping shipment.', {
          orderId: message.orderId,
          correlationId: message.correlationId,
          status: error.currentStatus
        });
      }
    }
  }

  /**
   * A cancellation can land between the fraud-approved step and this one;
   * updateStatus() rejects the write if that already happened, so the
   * cancelled order is never overwritten with SHIPPING/DELIVERED.
   */
  private async shipOrder(message: ShippingMessage): Promise<void> {
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

  private buildEvent(
    detailType: 'ShippingStarted' | 'ShippingCompleted',
    orderId: string,
    correlationId: string,
    status: 'SHIPPING' | 'DELIVERED'
  ) {
    return buildEventEnvelope<OrderEventDetail>(detailType, correlationId, {
      orderId,
      status
    });
  }
}

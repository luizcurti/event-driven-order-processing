import { randomUUID } from 'node:crypto';

import type { CreateOrderPayload } from '../../shared/validation/order-schema';
import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type { EventEnvelope, Order } from '../../shared/domain/order';
import type { OrderEventDetail } from '../../shared/domain/events';

export interface CreateOrderRequest extends CreateOrderPayload {
  correlationId: string;
  idempotencyKey: string;
}

export interface CreateOrderResult {
  orderId: string;
  status: Order['status'];
  reused: boolean;
}

export class CreateOrderUseCase {
  constructor(
    private readonly repository: OrderRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: StructuredLogger
  ) {}

  async execute(request: CreateOrderRequest): Promise<CreateOrderResult> {
    const existingOrder = await this.repository.findByIdempotencyKey(
      request.idempotencyKey
    );

    if (existingOrder) {
      this.logger.info('Order reused from idempotency key.', {
        orderId: existingOrder.id,
        correlationId: request.correlationId,
        status: existingOrder.status
      });

      return {
        orderId: existingOrder.id,
        status: existingOrder.status,
        reused: true
      };
    }

    const timestamp = new Date().toISOString();
    const order: Order = {
      id: randomUUID(),
      customerId: request.customerId,
      items: request.items,
      status: 'RECEIVED',
      createdAt: timestamp,
      updatedAt: timestamp,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey
    };

    await this.repository.create(order);

    const event: EventEnvelope<OrderEventDetail> = {
      source: 'order.processing',
      detailType: 'OrderCreated',
      version: 'v1',
      correlationId: request.correlationId,
      timestamp,
      detail: {
        orderId: order.id,
        customerId: order.customerId,
        items: order.items,
        status: order.status
      }
    };

    await this.eventPublisher.publish(event);

    this.logger.info('Order created successfully.', {
      orderId: order.id,
      correlationId: request.correlationId,
      status: order.status
    });

    return {
      orderId: order.id,
      status: order.status,
      reused: false
    };
  }
}

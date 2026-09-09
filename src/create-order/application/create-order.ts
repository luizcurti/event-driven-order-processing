import { randomUUID } from 'node:crypto';

import type { CreateOrderPayload } from '../../shared/validation/order-schema';
import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

import { buildEventEnvelope } from '../../shared/domain/event-envelope';
import { DuplicateIdempotencyKeyException } from '../../shared/errors/app-errors';

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
      return this.reuseOrder(existingOrder, request.correlationId);
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

    try {
      await this.repository.create(order);
    } catch (error) {
      if (error instanceof DuplicateIdempotencyKeyException) {
        const raceWinner = await this.repository.findByIdempotencyKey(
          request.idempotencyKey
        );

        if (raceWinner) {
          return this.reuseOrder(raceWinner, request.correlationId);
        }
      }

      throw error;
    }

    const event = buildEventEnvelope('OrderCreated', request.correlationId, {
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      status: order.status
    });

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

  private reuseOrder(order: Order, correlationId: string): CreateOrderResult {
    this.logger.info('Order reused from idempotency key.', {
      orderId: order.id,
      correlationId,
      status: order.status
    });

    return {
      orderId: order.id,
      status: order.status,
      reused: true
    };
  }
}

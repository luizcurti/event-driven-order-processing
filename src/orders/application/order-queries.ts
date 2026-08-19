import type { OrderRepository } from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

import {
  OrderAlreadyFinalizedException,
  OrderNotFoundException,
  ValidationError
} from '../../shared/errors/app-errors';

export class GetOrderUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(orderId: string): Promise<Order> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    return order;
  }
}

export class ListOrdersUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(): Promise<Order[]> {
    return this.repository.list();
  }
}

export class CancelOrderUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(orderId: string): Promise<Order> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    if (order.status === 'CANCELLED') {
      return order;
    }

    if (order.status === 'DELIVERED') {
      throw new ValidationError(
        `Order ${orderId} has already been delivered and cannot be cancelled.`
      );
    }

    try {
      return await this.repository.updateStatus(orderId, 'CANCELLED');
    } catch (error) {
      if (error instanceof OrderAlreadyFinalizedException) {
        return this.resolveConcurrentFinalization(orderId, error);
      }

      throw error;
    }
  }

  /**
   * The order reached CANCELLED or DELIVERED between our read above and the
   * write attempt (a concurrent cancel, or the workflow finishing delivery
   * first). Re-read the winning state instead of trusting our stale copy.
   */
  private async resolveConcurrentFinalization(
    orderId: string,
    error: OrderAlreadyFinalizedException
  ): Promise<Order> {
    if (error.currentStatus === 'CANCELLED') {
      const current = await this.repository.findById(orderId);

      if (current) {
        return current;
      }
    }

    throw new ValidationError(
      `Order ${orderId} is already ${error.currentStatus} and cannot be cancelled.`
    );
  }
}

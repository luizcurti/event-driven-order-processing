import type { OrderRepository } from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

import {
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

    return this.repository.updateStatus(orderId, 'CANCELLED');
  }
}

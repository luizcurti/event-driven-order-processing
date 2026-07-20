import type { OrderRepository } from '../../application/ports';
import type { Order, OrderStatus } from '../../domain/order';

import { OrderNotFoundException } from '../../errors/app-errors';

export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  create(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order, items: [...order.items] });
    return Promise.resolve();
  }

  findById(orderId: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    return Promise.resolve(
      [...this.orders.values()].find(
        (order) => order.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  list(): Promise<Order[]> {
    return Promise.resolve(
      [...this.orders.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      )
    );
  }

  updateStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = this.orders.get(orderId);

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    const updatedOrder: Order = {
      ...order,
      status,
      updatedAt: new Date().toISOString()
    };

    this.orders.set(orderId, updatedOrder);

    return Promise.resolve(updatedOrder);
  }
}

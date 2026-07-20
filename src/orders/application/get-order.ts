import type { OrderRepository } from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

import { OrderNotFoundException } from '../../shared/errors/app-errors';

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
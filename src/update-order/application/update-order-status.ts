import type { OrderRepository } from '../../shared/application/ports';
import type { Order, OrderStatus } from '../../shared/domain/order';

export class UpdateOrderStatusUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(orderId: string, status: OrderStatus): Promise<Order> {
    return this.repository.updateStatus(orderId, status);
  }
}

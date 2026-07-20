import type { OrderRepository } from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

export class CancelOrderUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(orderId: string): Promise<Order> {
    return this.repository.updateStatus(orderId, 'CANCELLED');
  }
}

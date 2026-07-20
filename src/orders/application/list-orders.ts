import type { OrderRepository } from '../../shared/application/ports';
import type { Order } from '../../shared/domain/order';

export class ListOrdersUseCase {
  constructor(private readonly repository: OrderRepository) {}

  async execute(): Promise<Order[]> {
    return this.repository.list();
  }
}
import { describe, expect, it } from 'vitest';

import { CreateOrderUseCase } from '../../src/create-order/application/create-order';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

describe('CreateOrderUseCase', () => {
  it('creates a new order and publishes OrderCreated event', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    const useCase = new CreateOrderUseCase(repository, eventPublisher, logger);

    const result = await useCase.execute({
      customerId: 'customer-123',
      items: [{ productId: 'ABC', quantity: 2 }],
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1'
    });

    expect(result.status).toBe('RECEIVED');
    expect(result.reused).toBe(false);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]?.detailType).toBe('OrderCreated');

    const persistedOrder = await repository.findById(result.orderId);
    expect(persistedOrder?.correlationId).toBe('corr-1');
  });

  it('reuses an order when the idempotency key already exists', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    const useCase = new CreateOrderUseCase(repository, eventPublisher, logger);

    const firstOrder = await useCase.execute({
      customerId: 'customer-123',
      items: [{ productId: 'ABC', quantity: 2 }],
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1'
    });

    const secondOrder = await useCase.execute({
      customerId: 'customer-123',
      items: [{ productId: 'XYZ', quantity: 1 }],
      correlationId: 'corr-2',
      idempotencyKey: 'idem-1'
    });

    expect(secondOrder.orderId).toBe(firstOrder.orderId);
    expect(secondOrder.reused).toBe(true);
    expect(eventPublisher.events).toHaveLength(1);
  });
});

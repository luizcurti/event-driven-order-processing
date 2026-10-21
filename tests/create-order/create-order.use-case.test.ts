import { describe, expect, it } from 'vitest';

import { CreateOrderUseCase } from '../../src/create-order/application/create-order';
import type { OrderRepository } from '../../src/shared/application/ports';
import type { Order } from '../../src/shared/domain/order';
import { DuplicateIdempotencyKeyException } from '../../src/shared/errors/app-errors';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

const buildOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-winner',
  customerId: 'customer-123',
  items: [{ productId: 'ABC', quantity: 2 }],
  status: 'RECEIVED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-race',
  ...overrides
});

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

  it('reuses the winning order when create() loses a concurrent idempotency race', async () => {
    const winner = buildOrder();
    let findCallCount = 0;

    const repository: OrderRepository = {
      create: () =>
        Promise.reject(new DuplicateIdempotencyKeyException('idem-race')),
      findById: () => Promise.resolve(null),
      findByIdempotencyKey: () => {
        findCallCount += 1;
        return Promise.resolve(findCallCount > 1 ? winner : null);
      },
      list: () => Promise.resolve([]),
      updateStatus: () => Promise.reject(new Error('not used in this test'))
    };
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    const useCase = new CreateOrderUseCase(repository, eventPublisher, logger);

    const result = await useCase.execute({
      customerId: 'customer-123',
      items: [{ productId: 'ABC', quantity: 2 }],
      correlationId: 'corr-2',
      idempotencyKey: 'idem-race'
    });

    expect(result).toEqual({
      orderId: winner.id,
      status: winner.status,
      reused: true
    });
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('rethrows when the race winner cannot be found after a duplicate create', async () => {
    const repository: OrderRepository = {
      create: () =>
        Promise.reject(new DuplicateIdempotencyKeyException('idem-race')),
      findById: () => Promise.resolve(null),
      findByIdempotencyKey: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      updateStatus: () => Promise.reject(new Error('not used in this test'))
    };
    const useCase = new CreateOrderUseCase(
      repository,
      new FakeEventPublisher(),
      new FakeLogger()
    );

    await expect(
      useCase.execute({
        customerId: 'customer-123',
        items: [{ productId: 'ABC', quantity: 2 }],
        correlationId: 'corr-3',
        idempotencyKey: 'idem-race'
      })
    ).rejects.toThrow(DuplicateIdempotencyKeyException);
  });

  it('rethrows unrelated repository errors from create()', async () => {
    const repository: OrderRepository = {
      create: () => Promise.reject(new Error('connection reset')),
      findById: () => Promise.resolve(null),
      findByIdempotencyKey: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      updateStatus: () => Promise.reject(new Error('not used in this test'))
    };
    const useCase = new CreateOrderUseCase(
      repository,
      new FakeEventPublisher(),
      new FakeLogger()
    );

    await expect(
      useCase.execute({
        customerId: 'customer-123',
        items: [{ productId: 'ABC', quantity: 2 }],
        correlationId: 'corr-4',
        idempotencyKey: 'idem-other'
      })
    ).rejects.toThrow('connection reset');
  });
});

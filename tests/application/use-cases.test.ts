import { describe, expect, it } from 'vitest';

import type { OrderRepository } from '../../src/shared/application/ports';
import type { Order, OrderStatus } from '../../src/shared/domain/order';

import { CheckFraudUseCase } from '../../src/fraud/application/check-fraud';
import { CheckInventoryUseCase } from '../../src/inventory/application/check-inventory';
import { SendNotificationUseCase } from '../../src/notification/application/send-notification';
import {
  CancelOrderUseCase,
  GetOrderUseCase,
  ListOrdersUseCase
} from '../../src/orders/application/order-queries';
import { ProcessPaymentUseCase } from '../../src/payment/application/process-payment';
import { OrderAlreadyFinalizedException } from '../../src/shared/errors/app-errors';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { ProcessShippingUseCase } from '../../src/shipping/application/process-shipping';
import { UpdateOrderStatusUseCase } from '../../src/update-order/application/update-order-status';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

const buildOrder = (status: OrderStatus): Order => ({
  id: 'order-race',
  customerId: 'customer-race',
  items: [{ productId: 'SKU-1', quantity: 1 }],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'corr-race',
  idempotencyKey: 'idem-race'
});

/**
 * Simulates a cancel racing another finalization: the initial read still
 * sees a cancellable order, but the write loses to whatever already landed
 * (another cancel, or a delivery), reported here as `finalizedStatus`.
 */
class RacingCancelRepository implements OrderRepository {
  private findCalls = 0;

  constructor(
    private readonly initialOrder: Order,
    private readonly finalizedStatus: OrderStatus,
    private readonly winner: Order | null
  ) {}

  findById(): Promise<Order | null> {
    this.findCalls += 1;
    return Promise.resolve(
      this.findCalls === 1 ? this.initialOrder : this.winner
    );
  }

  findByIdempotencyKey(): Promise<Order | null> {
    return Promise.resolve(null);
  }

  create(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<Order[]> {
    return Promise.resolve([]);
  }

  updateStatus(): Promise<Order> {
    return Promise.reject(
      new OrderAlreadyFinalizedException(
        this.initialOrder.id,
        this.finalizedStatus
      )
    );
  }
}

const repositoryThatFailsUpdateStatus = (
  order: Order,
  error: Error
): OrderRepository => ({
  findById: () => Promise.resolve(order),
  findByIdempotencyKey: () => Promise.resolve(null),
  create: () => Promise.resolve(),
  list: () => Promise.resolve([]),
  updateStatus: () => Promise.reject(error)
});

const seedOrder = async (
  repository: InMemoryOrderRepository,
  id: string,
  customerId: string,
  quantity: number
): Promise<void> => {
  await repository.create({
    id,
    customerId,
    items: [{ productId: 'SKU-1', quantity }],
    status: 'RECEIVED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    idempotencyKey: `idem-${id}`
  });
};

describe('application use cases', () => {
  it('gets, lists, cancels and updates orders', async () => {
    const repository = new InMemoryOrderRepository();
    await seedOrder(repository, 'order-1', 'customer-1', 1);
    await seedOrder(repository, 'order-2', 'customer-2', 1);

    expect((await new GetOrderUseCase(repository).execute('order-1')).id).toBe(
      'order-1'
    );
    await expect(
      new GetOrderUseCase(repository).execute('missing')
    ).rejects.toThrow('Order missing was not found.');
    expect(
      (await new ListOrdersUseCase(repository).execute()).map(
        (order) => order.id
      )
    ).toEqual(['order-1', 'order-2']);
    expect(
      (await new CancelOrderUseCase(repository).execute('order-1')).status
    ).toBe('CANCELLED');
    expect(
      (
        await new UpdateOrderStatusUseCase(repository).execute(
          'order-2',
          'APPROVED'
        )
      ).status
    ).toBe('APPROVED');
  });

  it('resolves a cancel race by returning the winner, or rejecting when delivery won', async () => {
    const pending = buildOrder('RECEIVED');

    const wonByAnotherCancel = new RacingCancelRepository(
      pending,
      'CANCELLED',
      buildOrder('CANCELLED')
    );
    expect(
      (await new CancelOrderUseCase(wonByAnotherCancel).execute(pending.id))
        .status
    ).toBe('CANCELLED');

    const vanishedAfterCancel = new RacingCancelRepository(
      pending,
      'CANCELLED',
      null
    );
    await expect(
      new CancelOrderUseCase(vanishedAfterCancel).execute(pending.id)
    ).rejects.toThrow('is already CANCELLED and cannot be cancelled.');

    const wonByDelivery = new RacingCancelRepository(
      pending,
      'DELIVERED',
      null
    );
    await expect(
      new CancelOrderUseCase(wonByDelivery).execute(pending.id)
    ).rejects.toThrow('is already DELIVERED and cannot be cancelled.');
  });

  it('propagates non-finalization errors from cancel instead of swallowing them', async () => {
    const pending = buildOrder('RECEIVED');
    const repository: OrderRepository = {
      findById: () => Promise.resolve(pending),
      findByIdempotencyKey: () => Promise.resolve(null),
      create: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      updateStatus: () => Promise.reject(new Error('ddb unavailable'))
    };

    await expect(
      new CancelOrderUseCase(repository).execute(pending.id)
    ).rejects.toThrow('ddb unavailable');
  });

  it('covers inventory success, inventory failure and missing order cases', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'available', 'customer-1', 1);
    await seedOrder(repository, 'missing-stock', 'customer-2', 8);

    const inventoryEnabled = new CheckInventoryUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: true, fraudCheckEnabled: true },
      logger
    );
    const inventoryDisabled = new CheckInventoryUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: false, fraudCheckEnabled: true },
      logger
    );

    expect(
      (await inventoryEnabled.execute('available', 'corr-1')).inventoryStatus
    ).toBe('AVAILABLE');
    expect(
      (await inventoryEnabled.execute('missing-stock', 'corr-2'))
        .inventoryStatus
    ).toBe('OUT_OF_STOCK');
    expect(
      (await inventoryDisabled.execute('missing-stock', 'corr-3'))
        .inventoryStatus
    ).toBe('AVAILABLE');
    await expect(inventoryEnabled.execute('missing', 'corr-4')).rejects.toThrow(
      'Order missing was not found for inventory validation.'
    );
  });

  it('skips the inventory update when the order was already finalized, and propagates other errors', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'cancelled-before-inventory', 'customer-1', 1);
    await repository.updateStatus('cancelled-before-inventory', 'CANCELLED');

    const useCase = new CheckInventoryUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: true, fraudCheckEnabled: true },
      logger
    );
    const result = await useCase.execute(
      'cancelled-before-inventory',
      'corr-1'
    );

    expect(result.inventoryStatus).toBe('AVAILABLE');
    expect(eventPublisher.events).toHaveLength(0);
    expect(logger.entries.at(-1)?.message).toBe(
      'Order was already finalized; skipping inventory update.'
    );

    const failingRepository = repositoryThatFailsUpdateStatus(
      buildOrder('RECEIVED'),
      new Error('ddb unavailable')
    );
    await expect(
      new CheckInventoryUseCase(
        failingRepository,
        eventPublisher,
        { inventoryCheckEnabled: true, fraudCheckEnabled: true },
        logger
      ).execute('order-race', 'corr-2')
    ).rejects.toThrow('ddb unavailable');
  });

  it('covers payment success, payment failure and missing order cases', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'approved', 'customer-1', 1);
    await seedOrder(repository, 'failed', 'fail-payment-customer', 1);

    const useCase = new ProcessPaymentUseCase(
      repository,
      eventPublisher,
      logger
    );

    expect((await useCase.execute('approved', 'corr-1')).paymentStatus).toBe(
      'APPROVED'
    );
    expect((await useCase.execute('failed', 'corr-2')).paymentStatus).toBe(
      'FAILED'
    );
    await expect(useCase.execute('missing', 'corr-3')).rejects.toThrow(
      'Order missing was not found for payment processing.'
    );
  });

  it('skips the payment update when the order was already finalized, and propagates other errors', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'cancelled-before-payment', 'customer-1', 1);
    await repository.updateStatus('cancelled-before-payment', 'CANCELLED');

    const useCase = new ProcessPaymentUseCase(
      repository,
      eventPublisher,
      logger
    );
    const result = await useCase.execute('cancelled-before-payment', 'corr-1');

    expect(result.paymentStatus).toBe('APPROVED');
    expect(eventPublisher.events).toHaveLength(0);
    expect(logger.entries.at(-1)?.message).toBe(
      'Order was already finalized; skipping payment update.'
    );

    const failingRepository = repositoryThatFailsUpdateStatus(
      buildOrder('RECEIVED'),
      new Error('ddb unavailable')
    );
    await expect(
      new ProcessPaymentUseCase(
        failingRepository,
        eventPublisher,
        logger
      ).execute('order-race', 'corr-2')
    ).rejects.toThrow('ddb unavailable');
  });

  it('covers fraud approval, rejection, feature flag bypass and missing order cases', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'approved', 'customer-1', 1);
    await seedOrder(repository, 'rejected', 'fraud-customer', 1);

    const enabled = new CheckFraudUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: true, fraudCheckEnabled: true },
      logger
    );
    const disabled = new CheckFraudUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: true, fraudCheckEnabled: false },
      logger
    );

    expect((await enabled.execute('approved', 'corr-1')).fraudStatus).toBe(
      'APPROVED'
    );
    expect((await enabled.execute('rejected', 'corr-2')).fraudStatus).toBe(
      'REJECTED'
    );
    expect((await disabled.execute('rejected', 'corr-3')).fraudStatus).toBe(
      'APPROVED'
    );
    await expect(enabled.execute('missing', 'corr-4')).rejects.toThrow(
      'Order missing was not found for fraud analysis.'
    );
  });

  it('skips the fraud update when the order was already finalized, and propagates other errors', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'cancelled-before-fraud', 'customer-1', 1);
    await repository.updateStatus('cancelled-before-fraud', 'CANCELLED');

    const useCase = new CheckFraudUseCase(
      repository,
      eventPublisher,
      { inventoryCheckEnabled: true, fraudCheckEnabled: true },
      logger
    );
    const result = await useCase.execute('cancelled-before-fraud', 'corr-1');

    expect(result.fraudStatus).toBe('APPROVED');
    expect(eventPublisher.events).toHaveLength(0);
    expect(logger.entries.at(-1)?.message).toBe(
      'Order was already finalized; skipping fraud update.'
    );

    const failingRepository = repositoryThatFailsUpdateStatus(
      buildOrder('RECEIVED'),
      new Error('ddb unavailable')
    );
    await expect(
      new CheckFraudUseCase(
        failingRepository,
        eventPublisher,
        { inventoryCheckEnabled: true, fraudCheckEnabled: true },
        logger
      ).execute('order-race', 'corr-2')
    ).rejects.toThrow('ddb unavailable');
  });

  it('processes shipping and notification messages', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'ship-1', 'customer-1', 1);

    await new ProcessShippingUseCase(
      repository,
      eventPublisher,
      logger
    ).execute({
      Records: [
        {
          messageId: 'message-1',
          receiptHandle: 'receipt',
          body: JSON.stringify({ orderId: 'ship-1', correlationId: 'corr-1' }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1',
            SenderId: 'local',
            ApproximateFirstReceiveTimestamp: '1'
          },
          messageAttributes: {},
          md5OfBody: 'hash',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:shipping',
          awsRegion: 'us-east-1'
        }
      ]
    });

    expect((await repository.findById('ship-1'))?.status).toBe('DELIVERED');
    expect(eventPublisher.events.map((event) => event.detailType)).toEqual([
      'ShippingStarted',
      'ShippingCompleted'
    ]);

    await new SendNotificationUseCase(logger).execute({
      Records: [
        {
          messageId: 'message-2',
          receiptHandle: 'receipt',
          body: JSON.stringify({
            orderId: 'ship-1',
            correlationId: 'corr-1',
            channel: 'email',
            reason: 'Inventory unavailable.'
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1',
            SenderId: 'local',
            ApproximateFirstReceiveTimestamp: '1'
          },
          messageAttributes: {},
          md5OfBody: 'hash',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:notification',
          awsRegion: 'us-east-1'
        }
      ]
    });

    expect(logger.entries.at(-1)?.status).toBe('SENT');
  });

  const buildShippingEvent = (
    orderId: string,
    correlationId: string,
    messageId: string
  ) => ({
    Records: [
      {
        messageId,
        receiptHandle: 'receipt',
        body: JSON.stringify({ orderId, correlationId }),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1',
          SenderId: 'local',
          ApproximateFirstReceiveTimestamp: '1'
        },
        messageAttributes: {},
        md5OfBody: 'hash',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:shipping',
        awsRegion: 'us-east-1'
      }
    ]
  });

  it('skips shipping for an order that was already finalized before it could ship', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'ship-cancelled', 'customer-1', 1);
    await repository.updateStatus('ship-cancelled', 'CANCELLED');

    await new ProcessShippingUseCase(
      repository,
      eventPublisher,
      logger
    ).execute(buildShippingEvent('ship-cancelled', 'corr-1', 'message-3'));

    expect((await repository.findById('ship-cancelled'))?.status).toBe(
      'CANCELLED'
    );
    expect(eventPublisher.events).toHaveLength(0);
    expect(logger.entries.at(-1)?.message).toBe(
      'Order was already finalized; skipping shipment.'
    );
  });

  it('propagates non-finalization errors from shipping instead of swallowing them', async () => {
    const repository: OrderRepository = {
      findById: () => Promise.resolve(buildOrder('APPROVED')),
      findByIdempotencyKey: () => Promise.resolve(null),
      create: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      updateStatus: () => Promise.reject(new Error('ddb unavailable'))
    };
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();

    await expect(
      new ProcessShippingUseCase(repository, eventPublisher, logger).execute(
        buildShippingEvent('order-race', 'corr-race', 'message-4')
      )
    ).rejects.toThrow('ddb unavailable');
  });
});

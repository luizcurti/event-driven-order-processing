import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

const seedOrder = async (repository: InMemoryOrderRepository, orderId: string, customerId = 'customer-1'): Promise<void> => {
  await repository.create({
    id: orderId,
    customerId,
    items: [{ productId: 'SKU-1', quantity: 1 }],
    status: 'RECEIVED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    idempotencyKey: `idem-${orderId}`
  });
};

describe('async handlers', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('executes the inventory, payment and fraud handlers', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'inventory-order');
    await seedOrder(repository, 'payment-order');
    await seedOrder(repository, 'fraud-order', 'fraud-customer');

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository,
      createEventPublisher: () => eventPublisher
    }));

    const inventoryModule = await import('../../src/inventory/handler/index');
    const paymentModule = await import('../../src/payment/handler/index');
    const fraudModule = await import('../../src/fraud/handler/index');

    expect(
      await inventoryModule.handler({ orderId: 'inventory-order', correlationId: 'corr-1' }, {} as never, vi.fn())
    ).toMatchObject({ inventoryStatus: 'AVAILABLE' });
    expect(
      await paymentModule.handler({ orderId: 'payment-order', correlationId: 'corr-2' }, {} as never, vi.fn())
    ).toMatchObject({ paymentStatus: 'APPROVED' });
    expect(
      await fraudModule.handler({ orderId: 'fraud-order', correlationId: 'corr-3' }, {} as never, vi.fn())
    ).toMatchObject({ fraudStatus: 'REJECTED' });
  });

  it('executes the shipping, notification and update-order handlers', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'shipping-order');
    await seedOrder(repository, 'update-order');

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository,
      createEventPublisher: () => eventPublisher
    }));

    const shippingModule = await import('../../src/shipping/handler/index');
    const updateModule = await import('../../src/update-order/handler/index');
    const notificationModule = await import('../../src/notification/handler/index');

    await shippingModule.handler({
      Records: [
        {
          messageId: 'message-1',
          receiptHandle: 'receipt',
          body: JSON.stringify({ orderId: 'shipping-order', correlationId: 'corr-1' }),
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
    }, {} as never, vi.fn());

    await notificationModule.handler({
      Records: [
        {
          messageId: 'message-2',
          receiptHandle: 'receipt',
          body: JSON.stringify({
            orderId: 'shipping-order',
            correlationId: 'corr-1',
            channel: 'email',
            reason: 'done'
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
    }, {} as never, vi.fn());

    expect(
      await updateModule.handler({ orderId: 'update-order', status: 'CANCELLED', correlationId: 'corr-2' }, {} as never, vi.fn())
    ).toMatchObject({ status: 'CANCELLED' });
    expect((await repository.findById('shipping-order'))?.status).toBe('DELIVERED');
  });
});
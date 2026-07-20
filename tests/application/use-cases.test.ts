import { describe, expect, it } from 'vitest';

import { CheckFraudUseCase } from '../../src/fraud/application/check-fraud';
import { CheckInventoryUseCase } from '../../src/inventory/application/check-inventory';
import { SendNotificationUseCase } from '../../src/notification/application/send-notification';
import { CancelOrderUseCase } from '../../src/orders/application/cancel-order';
import { GetOrderUseCase } from '../../src/orders/application/get-order';
import { ListOrdersUseCase } from '../../src/orders/application/list-orders';
import { ProcessPaymentUseCase } from '../../src/payment/application/process-payment';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { ProcessShippingUseCase } from '../../src/shipping/application/process-shipping';
import { UpdateOrderStatusUseCase } from '../../src/update-order/application/update-order-status';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

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

    expect((await new GetOrderUseCase(repository).execute('order-1')).id).toBe('order-1');
    await expect(new GetOrderUseCase(repository).execute('missing')).rejects.toThrow('Order missing was not found.');
    expect((await new ListOrdersUseCase(repository).execute()).map((order) => order.id)).toEqual(['order-1', 'order-2']);
    expect((await new CancelOrderUseCase(repository).execute('order-1')).status).toBe('CANCELLED');
    expect((await new UpdateOrderStatusUseCase(repository).execute('order-2', 'APPROVED')).status).toBe('APPROVED');
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

    expect((await inventoryEnabled.execute('available', 'corr-1')).inventoryStatus).toBe('AVAILABLE');
    expect((await inventoryEnabled.execute('missing-stock', 'corr-2')).inventoryStatus).toBe('OUT_OF_STOCK');
    expect((await inventoryDisabled.execute('missing-stock', 'corr-3')).inventoryStatus).toBe('AVAILABLE');
    await expect(inventoryEnabled.execute('missing', 'corr-4')).rejects.toThrow(
      'Order missing was not found for inventory validation.'
    );
  });

  it('covers payment success, payment failure and missing order cases', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'approved', 'customer-1', 1);
    await seedOrder(repository, 'failed', 'fail-payment-customer', 1);

    const useCase = new ProcessPaymentUseCase(repository, eventPublisher, logger);

    expect((await useCase.execute('approved', 'corr-1')).paymentStatus).toBe('APPROVED');
    expect((await useCase.execute('failed', 'corr-2')).paymentStatus).toBe('FAILED');
    await expect(useCase.execute('missing', 'corr-3')).rejects.toThrow('Order missing was not found for payment processing.');
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

    expect((await enabled.execute('approved', 'corr-1')).fraudStatus).toBe('APPROVED');
    expect((await enabled.execute('rejected', 'corr-2')).fraudStatus).toBe('REJECTED');
    expect((await disabled.execute('rejected', 'corr-3')).fraudStatus).toBe('APPROVED');
    await expect(enabled.execute('missing', 'corr-4')).rejects.toThrow('Order missing was not found for fraud analysis.');
  });

  it('processes shipping and notification messages', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const logger = new FakeLogger();
    await seedOrder(repository, 'ship-1', 'customer-1', 1);

    await new ProcessShippingUseCase(repository, eventPublisher, logger).execute({
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
    expect(eventPublisher.events.map((event) => event.detailType)).toEqual(['ShippingStarted', 'ShippingCompleted']);

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
});
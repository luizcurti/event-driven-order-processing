import { describe, expect, it } from 'vitest';

import { CheckFraudUseCase } from '../../src/fraud/application/check-fraud';
import { CheckInventoryUseCase } from '../../src/inventory/application/check-inventory';
import { ProcessPaymentUseCase } from '../../src/payment/application/process-payment';
import { ProcessShippingUseCase } from '../../src/shipping/application/process-shipping';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { FakeEventPublisher, FakeLogger, enabledFlags } from '../support/fakes';

const seedOrder = async (
  repository: InMemoryOrderRepository,
  input: {
    id: string;
    customerId: string;
    quantity: number;
  }
): Promise<void> => {
  await repository.create({
    id: input.id,
    customerId: input.customerId,
    items: [{ productId: 'SKU-1', quantity: input.quantity }],
    status: 'RECEIVED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    idempotencyKey: `idem-${input.id}`
  });
};

describe('Order processing use cases', () => {
  it('marks order as out of stock when quantity exceeds threshold', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const useCase = new CheckInventoryUseCase(
      repository,
      eventPublisher,
      enabledFlags,
      new FakeLogger()
    );
    await seedOrder(repository, {
      id: 'order-1',
      customerId: 'customer-1',
      quantity: 6
    });

    const result = await useCase.execute('order-1', 'corr-1');
    const order = await repository.findById('order-1');

    expect(result.inventoryStatus).toBe('OUT_OF_STOCK');
    expect(order?.status).toBe('OUT_OF_STOCK');
    expect(eventPublisher.events[0]?.detailType).toBe('InventoryFailed');
  });

  it('marks payment as failed for disallowed customers', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const useCase = new ProcessPaymentUseCase(
      repository,
      eventPublisher,
      new FakeLogger()
    );
    await seedOrder(repository, {
      id: 'order-2',
      customerId: 'fail-payment-customer',
      quantity: 1
    });

    const result = await useCase.execute('order-2', 'corr-2');
    const order = await repository.findById('order-2');

    expect(result.paymentStatus).toBe('FAILED');
    expect(order?.status).toBe('PAYMENT_FAILED');
    expect(eventPublisher.events[0]?.detailType).toBe('PaymentFailed');
  });

  it('rejects fraudulent customers and approves clean orders', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const useCase = new CheckFraudUseCase(
      repository,
      eventPublisher,
      enabledFlags,
      new FakeLogger()
    );
    await seedOrder(repository, {
      id: 'order-3',
      customerId: 'fraudulent-customer',
      quantity: 1
    });

    const rejectedResult = await useCase.execute('order-3', 'corr-3');
    const rejectedOrder = await repository.findById('order-3');

    expect(rejectedResult.fraudStatus).toBe('REJECTED');
    expect(rejectedOrder?.status).toBe('FRAUD_DETECTED');
    expect(eventPublisher.events[0]?.detailType).toBe('FraudRejected');

    await seedOrder(repository, {
      id: 'order-4',
      customerId: 'customer-4',
      quantity: 1
    });
    const approvedResult = await useCase.execute('order-4', 'corr-4');
    const approvedOrder = await repository.findById('order-4');

    expect(approvedResult.fraudStatus).toBe('APPROVED');
    expect(approvedOrder?.status).toBe('APPROVED');
    expect(eventPublisher.events[1]?.detailType).toBe('FraudApproved');
  });

  it('moves approved orders through shipping to delivered', async () => {
    const repository = new InMemoryOrderRepository();
    const eventPublisher = new FakeEventPublisher();
    const useCase = new ProcessShippingUseCase(
      repository,
      eventPublisher,
      new FakeLogger()
    );
    await seedOrder(repository, {
      id: 'order-5',
      customerId: 'customer-5',
      quantity: 1
    });

    await useCase.execute({
      Records: [
        {
          messageId: 'msg-1',
          receiptHandle: 'handle-1',
          body: JSON.stringify({ orderId: 'order-5', correlationId: 'corr-5' }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '0',
            SenderId: 'system',
            ApproximateFirstReceiveTimestamp: '0'
          },
          messageAttributes: {},
          md5OfBody: 'hash',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:shipping',
          awsRegion: 'us-east-1'
        }
      ]
    });

    const order = await repository.findById('order-5');

    expect(order?.status).toBe('DELIVERED');
    expect(eventPublisher.events.map((event) => event.detailType)).toEqual([
      'ShippingStarted',
      'ShippingCompleted'
    ]);
  });
});

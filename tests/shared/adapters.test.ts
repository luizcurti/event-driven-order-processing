import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBridgePublisher } from '../../src/shared/infrastructure/publishers/eventbridge-publisher';
import { SqsQueuePublisher } from '../../src/shared/infrastructure/publishers/sqs-queue-publisher';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';

const documentSendMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class DynamoDBClient {}
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class BaseCommand {
    constructor(public readonly input: unknown) {}
  }

  return {
    DynamoDBDocumentClient: {
      from: () => ({ send: documentSendMock })
    },
    GetCommand: BaseCommand,
    PutCommand: BaseCommand,
    QueryCommand: BaseCommand,
    UpdateCommand: BaseCommand
  };
});

describe('infrastructure adapters', () => {
  beforeEach(() => {
    documentSendMock.mockReset();
  });

  it('publishes events to EventBridge', async () => {
    const send = vi.fn().mockResolvedValue({});
    const publisher = new EventBridgePublisher(
      'event-bus',
      { send } as unknown as ConstructorParameters<typeof EventBridgePublisher>[1]
    );

    await publisher.publish({
      source: 'order.processing',
      detailType: 'OrderCreated',
      version: 'v1',
      correlationId: 'corr-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      detail: { orderId: 'order-1' }
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends messages to SQS', async () => {
    const send = vi.fn().mockResolvedValue({});
    const publisher = new SqsQueuePublisher({ send } as unknown as ConstructorParameters<typeof SqsQueuePublisher>[0]);

    await publisher.send('queue-url', { orderId: 'order-1' });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('persists and mutates orders in memory', async () => {
    const repository = new InMemoryOrderRepository();
    await repository.create({
      id: 'order-1',
      customerId: 'customer-1',
      items: [{ productId: 'SKU-1', quantity: 2 }],
      status: 'RECEIVED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1'
    });
    await repository.create({
      id: 'order-2',
      customerId: 'customer-2',
      items: [{ productId: 'SKU-2', quantity: 1 }],
      status: 'RECEIVED',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2'
    });

    expect(await repository.findById('missing')).toBeNull();
    expect((await repository.findById('order-1'))?.id).toBe('order-1');
    expect((await repository.findByIdempotencyKey('idem-2'))?.id).toBe('order-2');
    expect(await repository.findByIdempotencyKey('missing')).toBeNull();
    expect((await repository.list()).map((order) => order.id)).toEqual(['order-2', 'order-1']);
    expect((await repository.updateStatus('order-1', 'APPROVED')).status).toBe('APPROVED');
    await expect(Promise.resolve().then(() => repository.updateStatus('missing', 'APPROVED'))).rejects.toThrow(
      'Order missing was not found.'
    );
  });

  it('persists and reads orders through the DynamoDB repository adapter', async () => {
    const { DynamoDbOrderRepository } = await import('../../src/shared/infrastructure/repositories/dynamodb-order-repository');
    const repository = new DynamoDbOrderRepository('orders-table');

    documentSendMock.mockResolvedValueOnce({});
    await repository.create({
      id: 'order-1',
      customerId: 'customer-1',
      items: [{ productId: 'SKU-1', quantity: 1 }],
      status: 'RECEIVED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1'
    });

    documentSendMock.mockResolvedValueOnce({});
    expect(await repository.findById('order-1')).toBeNull();

    documentSendMock.mockResolvedValueOnce({
      Item: {
        pk: 'ORDER#order-1',
        sk: 'ORDER',
        id: 'order-1',
        customerId: 'customer-1',
        items: [{ productId: 'SKU-1', quantity: 1 }],
        status: 'RECEIVED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1'
      }
    });
    expect((await repository.findById('order-1'))?.customerId).toBe('customer-1');

    documentSendMock.mockResolvedValueOnce({ Items: [] });
    expect(await repository.findByIdempotencyKey('missing')).toBeNull();

    documentSendMock.mockResolvedValueOnce({
      Items: undefined
    });
    expect(await repository.list()).toEqual([]);

    documentSendMock.mockResolvedValueOnce({
      Items: [
        {
          pk: 'ORDER#order-1',
          sk: 'ORDER',
          id: 'order-1',
          customerId: 'customer-1',
          items: [{ productId: 'SKU-1', quantity: 1 }],
          status: 'RECEIVED',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          correlationId: 'corr-1',
          idempotencyKey: 'idem-1'
        }
      ]
    });
    expect((await repository.findByIdempotencyKey('idem-1'))?.id).toBe('order-1');

    documentSendMock.mockResolvedValueOnce({
      Items: [
        {
          pk: 'ORDER#order-1',
          sk: 'ORDER',
          id: 'order-1',
          customerId: 'customer-1',
          items: [{ productId: 'SKU-1', quantity: 1 }],
          status: 'RECEIVED',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          correlationId: 'corr-1',
          idempotencyKey: 'idem-1'
        },
        {
          pk: 'ORDER#order-2',
          sk: 'ORDER',
          id: 'order-2',
          customerId: 'customer-2',
          items: [{ productId: 'SKU-2', quantity: 1 }],
          status: 'RECEIVED',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          correlationId: 'corr-2',
          idempotencyKey: 'idem-2'
        }
      ]
    });
    expect((await repository.list()).map((order) => order.id)).toEqual(['order-2', 'order-1']);

    documentSendMock.mockResolvedValueOnce({ Attributes: undefined });
    await expect(repository.updateStatus('missing', 'APPROVED')).rejects.toThrow('Order missing was not found.');

    documentSendMock.mockResolvedValueOnce({
      Attributes: {
        pk: 'ORDER#order-1',
        sk: 'ORDER',
        id: 'order-1',
        customerId: 'customer-1',
        items: [{ productId: 'SKU-1', quantity: 1 }],
        status: 'APPROVED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1'
      }
    });
    expect((await repository.updateStatus('order-1', 'APPROVED')).status).toBe('APPROVED');
  });
});
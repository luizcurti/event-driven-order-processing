import { afterEach, describe, expect, it } from 'vitest';

import { EventBridgePublisher } from '../../src/shared/infrastructure/publishers/eventbridge-publisher';
import { SqsQueuePublisher } from '../../src/shared/infrastructure/publishers/sqs-queue-publisher';
import { DynamoDbOrderRepository } from '../../src/shared/infrastructure/repositories/dynamodb-order-repository';
import { createEventPublisher, createLogger, createOrderRepository, createQueuePublisher } from '../../src/shared/infrastructure/factory';
import { PowertoolsStructuredLogger } from '../../src/shared/infrastructure/logger';

describe('infrastructure factory', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    delete process.env.ORDERS_TABLE_NAME;
    delete process.env.EVENT_BUS_NAME;
  });

  it('creates infrastructure adapters when required environment variables are present', () => {
    process.env.ORDERS_TABLE_NAME = 'orders-table';
    process.env.EVENT_BUS_NAME = 'orders-bus';

    expect(createLogger('service')).toBeInstanceOf(PowertoolsStructuredLogger);
    expect(createOrderRepository()).toBeInstanceOf(DynamoDbOrderRepository);
    expect(createEventPublisher()).toBeInstanceOf(EventBridgePublisher);
    expect(createQueuePublisher()).toBeInstanceOf(SqsQueuePublisher);
  });

  it('fails fast when required environment variables are missing', () => {
    expect(() => createOrderRepository()).toThrow('ORDERS_TABLE_NAME environment variable is required.');
    expect(() => createEventPublisher()).toThrow('EVENT_BUS_NAME environment variable is required.');
  });
});
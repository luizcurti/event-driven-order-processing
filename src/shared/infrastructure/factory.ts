import type {
  EventPublisher,
  OrderRepository,
  QueuePublisher,
  StructuredLogger
} from '../application/ports';

import { PowertoolsStructuredLogger } from './logger';
import { EventBridgePublisher } from './publishers/eventbridge-publisher';
import { SqsQueuePublisher } from './publishers/sqs-queue-publisher';
import { DynamoDbOrderRepository } from './repositories/dynamodb-order-repository';

export const createLogger = (serviceName: string): StructuredLogger =>
  new PowertoolsStructuredLogger(serviceName);

export const createOrderRepository = (): OrderRepository => {
  const tableName = process.env.ORDERS_TABLE_NAME;

  if (!tableName) {
    throw new Error('ORDERS_TABLE_NAME environment variable is required.');
  }

  return new DynamoDbOrderRepository(tableName);
};

export const createEventPublisher = (): EventPublisher => {
  const eventBusName = process.env.EVENT_BUS_NAME;

  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME environment variable is required.');
  }

  return new EventBridgePublisher(eventBusName);
};

export const createQueuePublisher = (): QueuePublisher =>
  new SqsQueuePublisher();

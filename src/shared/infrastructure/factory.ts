import type { Handler } from 'aws-lambda';

import type {
  EventPublisher,
  FeatureFlags,
  OrderRepository,
  QueuePublisher,
  StructuredLogger
} from '../application/ports';
import type { OrderStepEvent } from '../domain/order';

import { PowertoolsStructuredLogger } from './logger';
import { EventBridgePublisher } from './publishers/eventbridge-publisher';
import { SqsQueuePublisher } from './publishers/sqs-queue-publisher';
import { DynamoDbOrderRepository } from './repositories/dynamodb-order-repository';

export const createLogger = (serviceName: string): StructuredLogger =>
  new PowertoolsStructuredLogger(serviceName);

export const createFeatureFlags = (): FeatureFlags => ({
  inventoryCheckEnabled: process.env.FEATURE_INVENTORY_CHECK !== 'false',
  fraudCheckEnabled: process.env.FEATURE_FRAUD_CHECK !== 'false'
});

/**
 * Wraps a Step Functions task use case, applying the shared boilerplate of
 * propagating correlation/order context to the logger before execution.
 */
export const createStepHandler = <TResult>(
  logger: StructuredLogger,
  execute: (orderId: string, correlationId: string) => Promise<TResult>
): Handler<OrderStepEvent, TResult> => {
  return async (event) => {
    logger.addContext({
      correlationId: event.correlationId,
      orderId: event.orderId
    });

    return execute(event.orderId, event.correlationId);
  };
};

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

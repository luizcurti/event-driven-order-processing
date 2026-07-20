import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient
} from '@aws-sdk/client-dynamodb';
import {
  CreateEventBusCommand,
  DescribeEventBusCommand,
  EventBridgeClient
} from '@aws-sdk/client-eventbridge';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  SetQueueAttributesCommand,
  SQSClient
} from '@aws-sdk/client-sqs';

import { createDynamoDbClientConfig } from '../../src/shared/infrastructure/aws-client-config';
import { createEventBridgeClientConfig } from '../../src/shared/infrastructure/aws-client-config';
import { createSqsClientConfig } from '../../src/shared/infrastructure/aws-client-config';

export interface LocalstackResources {
  tableName: string;
  eventBusName: string;
  shippingQueueUrl: string;
  notificationQueueUrl: string;
  deadLetterQueueUrl: string;
}

const localstackEndpoint =
  process.env.LOCAL_AWS_ENDPOINT ?? 'http://localhost:4567';
const resourcePrefix =
  process.env.LOCALSTACK_RESOURCE_PREFIX ??
  'event-driven-order-processing-local';

const tableName = `${resourcePrefix}-orders`;
const eventBusName = `${resourcePrefix}-bus`;
const deadLetterQueueName = `${resourcePrefix}-dead-letter-queue`;
const shippingQueueName = `${resourcePrefix}-shipping-queue`;
const notificationQueueName = `${resourcePrefix}-notification-queue`;

const enableLocalstackEnvironment = (): void => {
  process.env.USE_LOCALSTACK = 'true';
  process.env.LOCAL_AWS_ENDPOINT = localstackEndpoint;
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'test';
  process.env.AWS_SECRET_ACCESS_KEY =
    process.env.AWS_SECRET_ACCESS_KEY ?? 'test';
  process.env.ORDERS_TABLE_NAME = tableName;
  process.env.EVENT_BUS_NAME = eventBusName;
};

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const waitForLocalstack = async (): Promise<void> => {
  enableLocalstackEnvironment();
  const client = new SQSClient(createSqsClientConfig());

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await client.send(new ListQueuesCommand({ MaxResults: 1 }));
      return;
    } catch (error) {
      if (attempt === 30) {
        throw error;
      }

      await wait(1000);
    }
  }
};

const ensureOrdersTable = async (): Promise<void> => {
  const client = new DynamoDBClient(createDynamoDbClientConfig());

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return;
  } catch {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'idempotencyKey', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'IdempotencyIndex',
            KeySchema: [{ AttributeName: 'idempotencyKey', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'OrderTypeIndex',
            KeySchema: [{ AttributeName: 'sk', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' }
          }
        ]
      })
    );
  }
};

const ensureEventBus = async (): Promise<void> => {
  const client = new EventBridgeClient(createEventBridgeClientConfig());

  try {
    await client.send(new DescribeEventBusCommand({ Name: eventBusName }));
    return;
  } catch {
    await client.send(new CreateEventBusCommand({ Name: eventBusName }));
  }
};

const ensureQueue = async (
  client: SQSClient,
  queueName: string,
  redrivePolicy?: string
): Promise<string> => {
  try {
    const result = await client.send(
      new GetQueueUrlCommand({ QueueName: queueName })
    );
    return result.QueueUrl ?? '';
  } catch {
    const result = await client.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: redrivePolicy ? { RedrivePolicy: redrivePolicy } : undefined
      })
    );

    return result.QueueUrl ?? '';
  }
};

const ensureQueues = async (): Promise<
  Pick<
    LocalstackResources,
    'shippingQueueUrl' | 'notificationQueueUrl' | 'deadLetterQueueUrl'
  >
> => {
  const client = new SQSClient(createSqsClientConfig());

  const deadLetterQueueUrl = await ensureQueue(client, deadLetterQueueName);
  const deadLetterQueueAttributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: deadLetterQueueUrl,
      AttributeNames: ['QueueArn']
    })
  );

  const deadLetterQueueArn = deadLetterQueueAttributes.Attributes?.QueueArn;

  if (!deadLetterQueueArn) {
    throw new Error('Dead letter queue ARN was not returned by LocalStack.');
  }

  const redrivePolicy = JSON.stringify({
    deadLetterTargetArn: deadLetterQueueArn,
    maxReceiveCount: 3
  });

  const shippingQueueUrl = await ensureQueue(
    client,
    shippingQueueName,
    redrivePolicy
  );
  const notificationQueueUrl = await ensureQueue(
    client,
    notificationQueueName,
    redrivePolicy
  );

  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: shippingQueueUrl,
      Attributes: {
        RedrivePolicy: redrivePolicy
      }
    })
  );

  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: notificationQueueUrl,
      Attributes: {
        RedrivePolicy: redrivePolicy
      }
    })
  );

  return {
    shippingQueueUrl,
    notificationQueueUrl,
    deadLetterQueueUrl
  };
};

export const ensureLocalstackResources =
  async (): Promise<LocalstackResources> => {
    await waitForLocalstack();
    await ensureOrdersTable();
    await ensureEventBus();
    const queues = await ensureQueues();

    return {
      tableName,
      eventBusName,
      ...queues
    };
  };

const main = async (): Promise<void> => {
  const resources = await ensureLocalstackResources();
  process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
};

if (require.main === module) {
  void main();
}

import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import type { EventBridgeClientConfig } from '@aws-sdk/client-eventbridge';
import type { SQSClientConfig } from '@aws-sdk/client-sqs';

const isLocalAwsRuntimeEnabled = (): boolean =>
  process.env.LOCAL_AWS_ENDPOINT !== undefined || process.env.USE_LOCALSTACK === 'true';

const buildLocalAwsClientConfig = () => {
  if (!isLocalAwsRuntimeEnabled()) {
    return {};
  }

  const endpoint = process.env.LOCAL_AWS_ENDPOINT ?? 'http://localhost:4566';

  return {
    endpoint,
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test'
    }
  };
};

export const createDynamoDbClientConfig = (): DynamoDBClientConfig => buildLocalAwsClientConfig();

export const createEventBridgeClientConfig = (): EventBridgeClientConfig => buildLocalAwsClientConfig();

export const createSqsClientConfig = (): SQSClientConfig => buildLocalAwsClientConfig();

export const isLocalAwsRuntime = isLocalAwsRuntimeEnabled;
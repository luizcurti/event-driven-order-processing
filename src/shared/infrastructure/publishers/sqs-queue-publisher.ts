import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { QueuePublisher } from '../../application/ports';

import { createSqsClientConfig } from '../aws-client-config';

export class SqsQueuePublisher implements QueuePublisher {
  private readonly client: SQSClient;

  constructor(client = new SQSClient(createSqsClientConfig())) {
    this.client = client;
  }

  async send<TPayload>(queueUrl: string, payload: TPayload): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload)
      })
    );
  }
}
import {
  EventBridgeClient,
  PutEventsCommand
} from '@aws-sdk/client-eventbridge';

import type { EventPublisher } from '../../application/ports';
import type { EventEnvelope } from '../../domain/order';

import { createEventBridgeClientConfig } from '../aws-client-config';

export class EventBridgePublisher implements EventPublisher {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly eventBusName: string,
    client = new EventBridgeClient(createEventBridgeClientConfig())
  ) {
    this.client = client;
  }

  async publish<TDetail>(event: EventEnvelope<TDetail>): Promise<void> {
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.eventBusName,
            Source: event.source,
            DetailType: event.detailType,
            Detail: JSON.stringify({
              version: event.version,
              correlationId: event.correlationId,
              timestamp: event.timestamp,
              detail: event.detail
            })
          }
        ]
      })
    );
  }
}

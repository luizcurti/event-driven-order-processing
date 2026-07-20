import type {
  EventPublisher,
  FeatureFlags,
  QueuePublisher,
  StructuredLogger
} from '../../src/shared/application/ports';
import type { EventEnvelope } from '../../src/shared/domain/order';

export class FakeEventPublisher implements EventPublisher {
  public readonly events: Array<EventEnvelope<unknown>> = [];

  publish<TDetail>(event: EventEnvelope<TDetail>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeQueuePublisher implements QueuePublisher {
  public readonly messages: Array<{ queueUrl: string; payload: unknown }> = [];

  send<TPayload>(queueUrl: string, payload: TPayload): Promise<void> {
    this.messages.push({ queueUrl, payload });
    return Promise.resolve();
  }
}

export class FakeLogger implements StructuredLogger {
  public readonly entries: Array<Record<string, unknown>> = [];
  private readonly context: Record<string, string> = {};

  addContext(context: Record<string, string>): void {
    Object.assign(this.context, context);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: 'INFO', message, ...this.context, ...(metadata ?? {}) });
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.entries.push({ level: 'ERROR', message, ...this.context, ...(metadata ?? {}) });
  }
}

export const enabledFlags: FeatureFlags = {
  inventoryCheckEnabled: true,
  fraudCheckEnabled: true
};
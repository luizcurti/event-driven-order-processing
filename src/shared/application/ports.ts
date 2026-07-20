import type { EventEnvelope, Order, OrderStatus } from '../domain/order';

export interface OrderRepository {
  create(order: Order): Promise<void>;
  findById(orderId: string): Promise<Order | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  list(): Promise<Order[]>;
  updateStatus(orderId: string, status: OrderStatus): Promise<Order>;
}

export interface EventPublisher {
  publish<TDetail>(event: EventEnvelope<TDetail>): Promise<void>;
}

export interface QueuePublisher {
  send<TPayload>(queueUrl: string, payload: TPayload): Promise<void>;
}

export interface StructuredLogger {
  addContext(context: Record<string, string>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface FeatureFlags {
  inventoryCheckEnabled: boolean;
  fraudCheckEnabled: boolean;
}
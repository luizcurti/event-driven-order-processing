export const orderStatuses = [
  'RECEIVED',
  'PROCESSING',
  'APPROVED',
  'REJECTED',
  'OUT_OF_STOCK',
  'PAYMENT_FAILED',
  'FRAUD_DETECTED',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED'
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

/**
 * Statuses a workflow step must never silently overwrite: once an order is
 * cancelled or delivered, that outcome must win any race against an
 * in-flight (or late-arriving) status transition from another step.
 */
export const finalizedOrderStatuses: readonly OrderStatus[] = [
  'CANCELLED',
  'DELIVERED'
];

export const isOrderFinalized = (status: OrderStatus): boolean =>
  finalizedOrderStatuses.includes(status);

export interface OrderItem {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  idempotencyKey: string;
}

export interface EventEnvelope<TDetail> {
  source: 'order.processing';
  detailType: string;
  version: 'v1';
  correlationId: string;
  timestamp: string;
  detail: TDetail;
}

export interface OrderCreatedDetail {
  orderId: string;
  customerId: string;
  items: OrderItem[];
}

export interface OrderEventDetail {
  orderId: string;
  customerId?: string;
  items?: OrderItem[];
  status?: OrderStatus;
  reason?: string | undefined;
}

export type OrderEventType =
  | 'OrderCreated'
  | 'InventoryValidated'
  | 'InventoryFailed'
  | 'PaymentApproved'
  | 'PaymentFailed'
  | 'FraudApproved'
  | 'FraudRejected'
  | 'OrderApproved'
  | 'OrderRejected'
  | 'ShippingStarted'
  | 'ShippingCompleted';

export interface OrderStepEvent {
  orderId: string;
  correlationId: string;
}

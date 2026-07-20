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
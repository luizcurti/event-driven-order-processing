import type { OrderItem, OrderStatus } from './order';

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
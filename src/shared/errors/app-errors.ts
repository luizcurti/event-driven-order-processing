import type { OrderStatus } from '../domain/order';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class InventoryException extends AppError {
  constructor(message = 'Inventory check failed.') {
    super(message, 409, 'INVENTORY_ERROR');
  }
}

export class PaymentException extends AppError {
  constructor(message = 'Payment processing failed.') {
    super(message, 402, 'PAYMENT_ERROR');
  }
}

export class FraudException extends AppError {
  constructor(message = 'Fraud analysis rejected the order.') {
    super(message, 403, 'FRAUD_ERROR');
  }
}

export class OrderNotFoundException extends AppError {
  constructor(orderId: string) {
    super(`Order ${orderId} was not found.`, 404, 'ORDER_NOT_FOUND');
  }
}

/**
 * Internal-only signal thrown by repositories when a create() call loses a
 * concurrency race on the idempotency key. Callers should treat it as a
 * cue to re-read and return the winning order, not as an HTTP error.
 */
export class DuplicateIdempotencyKeyException extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Order with idempotency key ${idempotencyKey} already exists.`);
    this.name = new.target.name;
  }
}

/**
 * Internal-only signal thrown by repositories when a status transition is
 * attempted on an order that already reached a finalized status (cancelled
 * or delivered). Callers should treat it as an expected race between the
 * cancellation and the in-flight workflow, not a system error.
 */
export class OrderAlreadyFinalizedException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly currentStatus: OrderStatus
  ) {
    super(
      `Order ${orderId} is already ${currentStatus} and cannot be updated further.`
    );
    this.name = new.target.name;
  }
}

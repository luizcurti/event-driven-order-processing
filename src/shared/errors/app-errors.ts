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

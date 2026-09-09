import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';

import { buildEventEnvelope } from '../../shared/domain/event-envelope';
import {
  OrderAlreadyFinalizedException,
  PaymentException
} from '../../shared/errors/app-errors';

const FAILING_PAYMENT_CUSTOMER_PREFIX = 'fail-payment';
const MAX_TOTAL_QUANTITY = 10;

export interface PaymentResult {
  orderId: string;
  paymentStatus: 'APPROVED' | 'FAILED';
  correlationId: string;
}

export class ProcessPaymentUseCase {
  constructor(
    private readonly repository: OrderRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: StructuredLogger
  ) {}

  async execute(
    orderId: string,
    correlationId: string
  ): Promise<PaymentResult> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new PaymentException(
        `Order ${orderId} was not found for payment processing.`
      );
    }

    const totalQuantity = order.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const paymentStatus =
      order.customerId.startsWith(FAILING_PAYMENT_CUSTOMER_PREFIX) ||
      totalQuantity > MAX_TOTAL_QUANTITY
        ? 'FAILED'
        : 'APPROVED';
    const orderStatus =
      paymentStatus === 'APPROVED' ? 'PROCESSING' : 'PAYMENT_FAILED';

    try {
      await this.repository.updateStatus(orderId, orderStatus);
    } catch (error) {
      if (!(error instanceof OrderAlreadyFinalizedException)) {
        throw error;
      }

      this.logger.info(
        'Order was already finalized; skipping payment update.',
        {
          orderId,
          correlationId,
          status: error.currentStatus
        }
      );

      return { orderId, paymentStatus, correlationId };
    }

    const event = buildEventEnvelope(
      paymentStatus === 'APPROVED' ? 'PaymentApproved' : 'PaymentFailed',
      correlationId,
      {
        orderId,
        status: orderStatus,
        reason:
          paymentStatus === 'APPROVED'
            ? undefined
            : 'Payment gateway declined the transaction.'
      }
    );

    await this.eventPublisher.publish(event);
    this.logger.info('Payment processing completed.', {
      orderId,
      correlationId,
      paymentStatus
    });

    return { orderId, paymentStatus, correlationId };
  }
}

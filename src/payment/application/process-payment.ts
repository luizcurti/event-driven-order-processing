import type {
  EventPublisher,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type {
  EventEnvelope,
  OrderEventDetail
} from '../../shared/domain/order';

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
      throw new Error(`Order ${orderId} was not found for payment processing.`);
    }

    const totalQuantity = order.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const paymentStatus =
      order.customerId.startsWith('fail-payment') || totalQuantity > 10
        ? 'FAILED'
        : 'APPROVED';

    await this.repository.updateStatus(
      orderId,
      paymentStatus === 'APPROVED' ? 'PROCESSING' : 'PAYMENT_FAILED'
    );

    const event: EventEnvelope<OrderEventDetail> = {
      source: 'order.processing',
      detailType:
        paymentStatus === 'APPROVED' ? 'PaymentApproved' : 'PaymentFailed',
      version: 'v1',
      correlationId,
      timestamp: new Date().toISOString(),
      detail: {
        orderId,
        status: paymentStatus === 'APPROVED' ? 'PROCESSING' : 'PAYMENT_FAILED',
        reason:
          paymentStatus === 'APPROVED'
            ? undefined
            : 'Payment gateway declined the transaction.'
      }
    };

    await this.eventPublisher.publish(event);
    this.logger.info('Payment processing completed.', {
      orderId,
      correlationId,
      paymentStatus
    });

    return { orderId, paymentStatus, correlationId };
  }
}

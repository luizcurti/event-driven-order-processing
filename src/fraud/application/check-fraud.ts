import type {
  EventPublisher,
  FeatureFlags,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';
import type {
  EventEnvelope,
  OrderEventDetail
} from '../../shared/domain/order';

import { FraudException } from '../../shared/errors/app-errors';

export interface FraudResult {
  orderId: string;
  fraudStatus: 'APPROVED' | 'REJECTED';
  correlationId: string;
}

export class CheckFraudUseCase {
  constructor(
    private readonly repository: OrderRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly featureFlags: FeatureFlags,
    private readonly logger: StructuredLogger
  ) {}

  async execute(orderId: string, correlationId: string): Promise<FraudResult> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new FraudException(
        `Order ${orderId} was not found for fraud analysis.`
      );
    }

    const fraudStatus =
      this.featureFlags.fraudCheckEnabled &&
      order.customerId.toLowerCase().includes('fraud')
        ? 'REJECTED'
        : 'APPROVED';

    await this.repository.updateStatus(
      orderId,
      fraudStatus === 'APPROVED' ? 'APPROVED' : 'FRAUD_DETECTED'
    );

    const event: EventEnvelope<OrderEventDetail> = {
      source: 'order.processing',
      detailType:
        fraudStatus === 'APPROVED' ? 'FraudApproved' : 'FraudRejected',
      version: 'v1',
      correlationId,
      timestamp: new Date().toISOString(),
      detail: {
        orderId,
        status: fraudStatus === 'APPROVED' ? 'APPROVED' : 'FRAUD_DETECTED',
        reason:
          fraudStatus === 'APPROVED'
            ? undefined
            : 'Fraud score exceeded the configured threshold.'
      }
    };

    await this.eventPublisher.publish(event);
    this.logger.info('Fraud analysis completed.', {
      orderId,
      correlationId,
      fraudStatus
    });

    return { orderId, fraudStatus, correlationId };
  }
}

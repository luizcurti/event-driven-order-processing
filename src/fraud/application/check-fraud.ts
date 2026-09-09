import type {
  EventPublisher,
  FeatureFlags,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';

import { buildEventEnvelope } from '../../shared/domain/event-envelope';
import {
  FraudException,
  OrderAlreadyFinalizedException
} from '../../shared/errors/app-errors';

const FRAUD_KEYWORD = 'fraud';

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
      order.customerId.toLowerCase().includes(FRAUD_KEYWORD)
        ? 'REJECTED'
        : 'APPROVED';
    const orderStatus =
      fraudStatus === 'APPROVED' ? 'APPROVED' : 'FRAUD_DETECTED';

    try {
      await this.repository.updateStatus(orderId, orderStatus);
    } catch (error) {
      if (!(error instanceof OrderAlreadyFinalizedException)) {
        throw error;
      }

      this.logger.info('Order was already finalized; skipping fraud update.', {
        orderId,
        correlationId,
        status: error.currentStatus
      });

      return { orderId, fraudStatus, correlationId };
    }

    const event = buildEventEnvelope(
      fraudStatus === 'APPROVED' ? 'FraudApproved' : 'FraudRejected',
      correlationId,
      {
        orderId,
        status: orderStatus,
        reason:
          fraudStatus === 'APPROVED'
            ? undefined
            : 'Fraud score exceeded the configured threshold.'
      }
    );

    await this.eventPublisher.publish(event);
    this.logger.info('Fraud analysis completed.', {
      orderId,
      correlationId,
      fraudStatus
    });

    return { orderId, fraudStatus, correlationId };
  }
}

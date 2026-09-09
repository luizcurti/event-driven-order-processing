import type {
  EventPublisher,
  FeatureFlags,
  OrderRepository,
  StructuredLogger
} from '../../shared/application/ports';

import { buildEventEnvelope } from '../../shared/domain/event-envelope';
import {
  InventoryException,
  OrderAlreadyFinalizedException
} from '../../shared/errors/app-errors';

const MAX_AVAILABLE_QUANTITY_PER_ITEM = 5;

export interface InventoryResult {
  orderId: string;
  inventoryStatus: 'AVAILABLE' | 'OUT_OF_STOCK';
  correlationId: string;
}

export class CheckInventoryUseCase {
  constructor(
    private readonly repository: OrderRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly featureFlags: FeatureFlags,
    private readonly logger: StructuredLogger
  ) {}

  async execute(
    orderId: string,
    correlationId: string
  ): Promise<InventoryResult> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new InventoryException(
        `Order ${orderId} was not found for inventory validation.`
      );
    }

    const inventoryStatus =
      this.featureFlags.inventoryCheckEnabled &&
      order.items.some(
        (item) => item.quantity > MAX_AVAILABLE_QUANTITY_PER_ITEM
      )
        ? 'OUT_OF_STOCK'
        : 'AVAILABLE';
    const orderStatus =
      inventoryStatus === 'AVAILABLE' ? 'PROCESSING' : 'OUT_OF_STOCK';

    try {
      await this.repository.updateStatus(orderId, orderStatus);
    } catch (error) {
      if (!(error instanceof OrderAlreadyFinalizedException)) {
        throw error;
      }

      this.logger.info(
        'Order was already finalized; skipping inventory update.',
        {
          orderId,
          correlationId,
          status: error.currentStatus
        }
      );

      return { orderId, inventoryStatus, correlationId };
    }

    const event = buildEventEnvelope(
      inventoryStatus === 'AVAILABLE'
        ? 'InventoryValidated'
        : 'InventoryFailed',
      correlationId,
      {
        orderId,
        status: orderStatus,
        reason:
          inventoryStatus === 'AVAILABLE'
            ? undefined
            : 'Requested quantity exceeded available stock.'
      }
    );

    await this.eventPublisher.publish(event);
    this.logger.info('Inventory validation completed.', {
      orderId,
      correlationId,
      inventoryStatus
    });

    return { orderId, inventoryStatus, correlationId };
  }
}

import type { EventPublisher, FeatureFlags, OrderRepository, StructuredLogger } from '../../shared/application/ports';
import type { EventEnvelope } from '../../shared/domain/order';
import type { OrderEventDetail } from '../../shared/domain/events';

import { InventoryException } from '../../shared/errors/app-errors';

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

  async execute(orderId: string, correlationId: string): Promise<InventoryResult> {
    const order = await this.repository.findById(orderId);

    if (!order) {
      throw new InventoryException(`Order ${orderId} was not found for inventory validation.`);
    }

    const inventoryStatus =
      this.featureFlags.inventoryCheckEnabled && order.items.some((item) => item.quantity > 5)
        ? 'OUT_OF_STOCK'
        : 'AVAILABLE';

    await this.repository.updateStatus(orderId, inventoryStatus === 'AVAILABLE' ? 'PROCESSING' : 'OUT_OF_STOCK');

    const event: EventEnvelope<OrderEventDetail> = {
      source: 'order.processing',
      detailType: inventoryStatus === 'AVAILABLE' ? 'InventoryValidated' : 'InventoryFailed',
      version: 'v1',
      correlationId,
      timestamp: new Date().toISOString(),
      detail: {
        orderId,
        status: inventoryStatus === 'AVAILABLE' ? 'PROCESSING' : 'OUT_OF_STOCK',
        reason: inventoryStatus === 'AVAILABLE' ? undefined : 'Requested quantity exceeded available stock.'
      }
    };

    await this.eventPublisher.publish(event);
    this.logger.info('Inventory validation completed.', { orderId, correlationId, inventoryStatus });

    return { orderId, inventoryStatus, correlationId };
  }
}
import type { EventEnvelope, OrderEventType } from './order';

export const buildEventEnvelope = <TDetail>(
  detailType: OrderEventType,
  correlationId: string,
  detail: TDetail
): EventEnvelope<TDetail> => ({
  source: 'order.processing',
  detailType,
  version: 'v1',
  correlationId,
  timestamp: new Date().toISOString(),
  detail
});

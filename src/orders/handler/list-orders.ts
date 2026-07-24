import {
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';
import { jsonResponse, withHttpHandler } from '../../shared/utils/http';
import { ListOrdersUseCase } from '../application/order-queries';

const logger = createLogger('list-orders');
const useCase = new ListOrdersUseCase(createOrderRepository());

export const handler = withHttpHandler(logger, 'list orders', async () => {
  const orders = await useCase.execute();
  return jsonResponse(200, orders);
});

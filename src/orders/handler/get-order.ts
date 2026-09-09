import {
  createLogger,
  createOrderRepository
} from '../../shared/infrastructure/factory';
import { jsonResponse, withHttpHandler } from '../../shared/utils/http';
import { ValidationError } from '../../shared/errors/app-errors';
import { GetOrderUseCase } from '../application/order-queries';

const logger = createLogger('get-order');
const useCase = new GetOrderUseCase(createOrderRepository());

export const handler = withHttpHandler(logger, 'get order', async (event) => {
  const orderId = event.pathParameters?.id;

  if (!orderId) {
    throw new ValidationError('Order id is required.');
  }

  const order = await useCase.execute(orderId);

  return jsonResponse(200, order);
});

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyHandlerV2
} from 'aws-lambda';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as OrderQueriesModule from '../../src/orders/application/order-queries';
import { InMemoryOrderRepository } from '../../src/shared/infrastructure/repositories/in-memory-order-repository';
import { FakeEventPublisher, FakeLogger } from '../support/fakes';

const baseEvent = (
  overrides: Partial<APIGatewayProxyEventV2> = {}
): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: '/orders',
  rawQueryString: '',
  headers: {},
  requestContext: {
    accountId: '000000000000',
    apiId: 'api-id',
    domainName: 'localhost',
    domainPrefix: 'localhost',
    requestId: 'request-id',
    routeKey: '$default',
    stage: '$default',
    time: 'now',
    timeEpoch: 0,
    http: {
      method: 'POST',
      path: '/orders',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'vitest'
    }
  },
  isBase64Encoded: false,
  ...overrides
});

const invokeHandler = async (
  handler: APIGatewayProxyHandlerV2,
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> => {
  const result = await handler(event, {} as never, vi.fn());

  return result as APIGatewayProxyStructuredResultV2;
};

const parseErrorBody = (
  response: APIGatewayProxyStructuredResultV2
): { error: string; message: string } =>
  JSON.parse(response.body ?? '{}') as { error: string; message: string };

const seedOrder = async (
  repository: InMemoryOrderRepository,
  orderId = 'order-1'
): Promise<void> => {
  await repository.create({
    id: orderId,
    customerId: 'customer-1',
    items: [{ productId: 'SKU-1', quantity: 1 }],
    status: 'RECEIVED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    correlationId: 'corr-1',
    idempotencyKey: `idem-${orderId}`
  });
};

describe('HTTP handlers', () => {
  afterEach(() => {
    // vi.resetModules() alone does not clear vi.doMock() factory
    // registrations, so a module mocked via importOriginal() in one test
    // (e.g. the "unknown failures" tests below) would otherwise leak into
    // later tests and hand them classes bound to a stale module realm,
    // breaking `instanceof AppError` checks in unrelated tests.
    vi.doUnmock('../../src/orders/application/order-queries');
    vi.doUnmock('../../src/create-order/application/create-order');
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('handles create-order success, idempotency and invalid requests', async () => {
    const repository = new InMemoryOrderRepository();
    const logger = new FakeLogger();
    const eventPublisher = new FakeEventPublisher();

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository,
      createEventPublisher: () => eventPublisher,
      createQueuePublisher: vi.fn()
    }));

    const { handler } = await import('../../src/create-order/handler/index');

    const created = await invokeHandler(
      handler,
      baseEvent({
        body: JSON.stringify({
          customerId: 'customer-1',
          items: [{ productId: 'SKU-1', quantity: 1 }]
        }),
        headers: { 'x-correlation-id': 'corr-1', 'idempotency-key': 'idem-1' }
      })
    );
    const reused = await invokeHandler(
      handler,
      baseEvent({
        body: JSON.stringify({
          customerId: 'customer-1',
          items: [{ productId: 'SKU-1', quantity: 1 }]
        }),
        headers: { 'x-correlation-id': 'corr-1', 'idempotency-key': 'idem-1' }
      })
    );
    const missingBodyEvent = baseEvent();
    delete (missingBodyEvent as { body?: string }).body;
    const missingBody = await invokeHandler(handler, missingBodyEvent);
    const invalidJson = await invokeHandler(handler, baseEvent({ body: '{' }));
    const invalidSchema = await invokeHandler(
      handler,
      baseEvent({ body: JSON.stringify({ items: [] }) })
    );

    expect(created.statusCode).toBe(202);
    expect(reused.statusCode).toBe(200);
    expect(missingBody.statusCode).toBe(400);
    expect(invalidJson.statusCode).toBe(400);
    expect(parseErrorBody(invalidJson).error).toBe('VALIDATION_ERROR');
    expect(invalidSchema.statusCode).toBe(400);
    expect(parseErrorBody(invalidSchema).error).toBe('VALIDATION_ERROR');
    expect(logger.entries.some((entry) => entry.level === 'ERROR')).toBe(true);
  });

  it('handles create-order unknown failures and falls back to unknown request ids', async () => {
    const logger = new FakeLogger();

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: vi.fn(),
      createEventPublisher: vi.fn(),
      createQueuePublisher: vi.fn()
    }));
    vi.doMock('../../src/create-order/application/create-order', () => ({
      CreateOrderUseCase: class {
        execute(): Promise<never> {
          const rejectionReason = new Error('boom');
          Object.setPrototypeOf(rejectionReason, null);
          return Promise.reject(rejectionReason);
        }
      }
    }));

    const { handler } = await import('../../src/create-order/handler/index');
    const event = baseEvent({
      body: JSON.stringify({
        customerId: 'customer-1',
        items: [{ productId: 'SKU-1', quantity: 1 }]
      }),
      requestContext: { ...baseEvent().requestContext }
    });
    Reflect.deleteProperty(event.requestContext, 'requestId');
    const response = await invokeHandler(handler, event);

    expect(response.statusCode).toBe(500);
    expect(logger.entries.at(-1)?.error).toBe('unknown');
    expect(logger.entries.at(-1)?.requestId).toBe('unknown');
  });

  it('handles get-order success and validation/not-found failures', async () => {
    const repository = new InMemoryOrderRepository();
    const logger = new FakeLogger();
    await seedOrder(repository);

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository
    }));

    const { handler } = await import('../../src/orders/handler/get-order');
    const success = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'order-1' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'GET' }
        }
      })
    );
    const missingId = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: {},
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'GET' }
        }
      })
    );
    const notFound = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'missing' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'GET' }
        }
      })
    );

    expect(success.statusCode).toBe(200);
    expect(missingId.statusCode).toBe(400);
    expect(notFound.statusCode).toBe(404);
  });

  it('handles get-order unknown failures and falls back to unknown request ids', async () => {
    const logger = new FakeLogger();

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: vi.fn()
    }));
    vi.doMock(
      '../../src/orders/application/order-queries',
      async (importOriginal) => {
        const actual = await importOriginal<typeof OrderQueriesModule>();

        return {
          ...actual,
          GetOrderUseCase: class {
            execute(): Promise<never> {
              const rejectionReason = new Error('boom');
              Object.setPrototypeOf(rejectionReason, null);
              return Promise.reject(rejectionReason);
            }
          }
        };
      }
    );

    const { handler } = await import('../../src/orders/handler/get-order');
    const event = baseEvent({
      pathParameters: { id: 'order-1' },
      requestContext: {
        ...baseEvent().requestContext,
        http: { ...baseEvent().requestContext.http, method: 'GET' }
      }
    });
    Reflect.deleteProperty(event.requestContext, 'requestId');
    const response = await invokeHandler(handler, event);

    expect(response.statusCode).toBe(500);
    expect(logger.entries.at(-1)?.error).toBe('unknown');
    expect(logger.entries.at(-1)?.requestId).toBe('unknown');
  });

  it('handles list-orders success and infrastructure failures', async () => {
    const logger = new FakeLogger();
    const repository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdempotencyKey: vi.fn(),
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('boom')),
      updateStatus: vi.fn()
    };

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository
    }));

    const { handler } = await import('../../src/orders/handler/list-orders');
    const success = await invokeHandler(
      handler,
      baseEvent({
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'GET' }
        }
      })
    );
    const failure = await invokeHandler(
      handler,
      baseEvent({
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'GET' }
        }
      })
    );

    expect(success.statusCode).toBe(200);
    expect(failure.statusCode).toBe(500);
  });

  it('handles list-orders unknown failures and falls back to unknown request ids', async () => {
    const logger = new FakeLogger();

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: vi.fn()
    }));
    vi.doMock(
      '../../src/orders/application/order-queries',
      async (importOriginal) => {
        const actual = await importOriginal<typeof OrderQueriesModule>();

        return {
          ...actual,
          ListOrdersUseCase: class {
            execute(): Promise<never> {
              const rejectionReason = new Error('boom');
              Object.setPrototypeOf(rejectionReason, null);
              return Promise.reject(rejectionReason);
            }
          }
        };
      }
    );

    const { handler } = await import('../../src/orders/handler/list-orders');
    const event = baseEvent({
      requestContext: {
        ...baseEvent().requestContext,
        http: { ...baseEvent().requestContext.http, method: 'GET' }
      }
    });
    Reflect.deleteProperty(event.requestContext, 'requestId');
    const response = await invokeHandler(handler, event);

    expect(response.statusCode).toBe(500);
    expect(logger.entries.at(-1)?.error).toBe('unknown');
    expect(logger.entries.at(-1)?.requestId).toBe('unknown');
  });

  it('handles cancel-order success and validation failures', async () => {
    const repository = new InMemoryOrderRepository();
    const logger = new FakeLogger();
    await seedOrder(repository);

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: () => repository
    }));

    const { handler } = await import('../../src/orders/handler/cancel-order');
    const success = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'order-1' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'DELETE' }
        }
      })
    );
    const missingId = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: {},
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'DELETE' }
        }
      })
    );
    const notFound = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'missing' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'DELETE' }
        }
      })
    );
    const alreadyCancelled = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'order-1' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'DELETE' }
        }
      })
    );

    await seedOrder(repository, 'order-2');
    await repository.updateStatus('order-2', 'DELIVERED');
    const alreadyDelivered = await invokeHandler(
      handler,
      baseEvent({
        pathParameters: { id: 'order-2' },
        requestContext: {
          ...baseEvent().requestContext,
          http: { ...baseEvent().requestContext.http, method: 'DELETE' }
        }
      })
    );

    expect(success.statusCode).toBe(200);
    expect(missingId.statusCode).toBe(400);
    expect(notFound.statusCode).toBe(404);
    expect(alreadyCancelled.statusCode).toBe(200);
    expect(
      (JSON.parse(alreadyCancelled.body ?? '{}') as { status: string }).status
    ).toBe('CANCELLED');
    expect(alreadyDelivered.statusCode).toBe(400);
  });

  it('handles cancel-order unknown failures and falls back to unknown request ids', async () => {
    const logger = new FakeLogger();

    vi.doMock('../../src/shared/infrastructure/factory', () => ({
      createLogger: () => logger,
      createOrderRepository: vi.fn()
    }));
    vi.doMock(
      '../../src/orders/application/order-queries',
      async (importOriginal) => {
        const actual = await importOriginal<typeof OrderQueriesModule>();

        return {
          ...actual,
          CancelOrderUseCase: class {
            execute(): Promise<never> {
              const rejectionReason = new Error('boom');
              Object.setPrototypeOf(rejectionReason, null);
              return Promise.reject(rejectionReason);
            }
          }
        };
      }
    );

    const { handler } = await import('../../src/orders/handler/cancel-order');
    const event = baseEvent({
      pathParameters: { id: 'order-1' },
      requestContext: {
        ...baseEvent().requestContext,
        http: { ...baseEvent().requestContext.http, method: 'DELETE' }
      }
    });
    Reflect.deleteProperty(event.requestContext, 'requestId');
    const response = await invokeHandler(handler, event);

    expect(response.statusCode).toBe(500);
    expect(logger.entries.at(-1)?.error).toBe('unknown');
    expect(logger.entries.at(-1)?.requestId).toBe('unknown');
  });
});

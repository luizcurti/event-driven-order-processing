import http from 'node:http';
import { URL } from 'node:url';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2
} from 'aws-lambda';

import { CreateOrderUseCase } from '../../src/create-order/application/create-order';
import { CheckFraudUseCase } from '../../src/fraud/application/check-fraud';
import { CheckInventoryUseCase } from '../../src/inventory/application/check-inventory';
import { SendNotificationUseCase } from '../../src/notification/application/send-notification';
import {
  CancelOrderUseCase,
  GetOrderUseCase,
  ListOrdersUseCase
} from '../../src/orders/application/order-queries';
import { ProcessPaymentUseCase } from '../../src/payment/application/process-payment';
import type {
  EventEnvelope,
  OrderEventDetail
} from '../../src/shared/domain/order';
import { ValidationError } from '../../src/shared/errors/app-errors';
import {
  createEventPublisher,
  createFeatureFlags,
  createLogger,
  createOrderRepository
} from '../../src/shared/infrastructure/factory';
import {
  createLambdaClientConfig,
  createSqsClientConfig
} from '../../src/shared/infrastructure/aws-client-config';
import { createQueuePublisher } from '../../src/shared/infrastructure/factory';
import {
  enableDefaultMetrics,
  httpRequestDurationSeconds,
  orderWorkflowOutcomesTotal,
  ordersCreatedTotal,
  registry
} from '../../src/shared/infrastructure/metrics';
import { errorResponse, jsonResponse } from '../../src/shared/utils/http';
import { ProcessShippingUseCase } from '../../src/shipping/application/process-shipping';
import { parseCreateOrderPayload } from '../../src/shared/validation/order-schema';
import { ensureLocalstackResources, resourcePrefix } from './bootstrap';

interface LocalServerHandle {
  port: number;
  close(): Promise<void>;
}

const readBody = async (request: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    chunks.push(Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const sendResponse = (
  response: http.ServerResponse,
  payload: APIGatewayProxyStructuredResultV2
): void => {
  const headers = Object.fromEntries(
    Object.entries(
      payload.headers ?? { 'content-type': 'application/json' }
    ).map(([key, value]) => [key, String(value)])
  );

  response.writeHead(payload.statusCode ?? 200, headers);
  response.end(payload.body ?? '');
};

const toSqsEvent = (messageBody: string) => ({
  Records: [
    {
      messageId: 'local-message',
      receiptHandle: 'local-handle',
      body: messageBody,
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: Date.now().toString(),
        SenderId: 'local',
        ApproximateFirstReceiveTimestamp: Date.now().toString()
      },
      messageAttributes: {},
      md5OfBody: 'local',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:local',
      awsRegion: 'us-east-1'
    }
  ]
});

export const startLocalServer = async (
  port = Number(process.env.PORT ?? 3000)
): Promise<LocalServerHandle> => {
  const resources = await ensureLocalstackResources();

  enableDefaultMetrics();

  process.env.LOG_FILE_PATH ??= 'logs/local-server.log';
  const logger = createLogger('local-server');
  const repository = createOrderRepository();
  const eventPublisher = createEventPublisher();
  const queuePublisher = createQueuePublisher();
  const sqsClient = new SQSClient(createSqsClientConfig());

  const createOrderUseCase = new CreateOrderUseCase(
    repository,
    eventPublisher,
    logger
  );
  const getOrderUseCase = new GetOrderUseCase(repository);
  const listOrdersUseCase = new ListOrdersUseCase(repository);
  const cancelOrderUseCase = new CancelOrderUseCase(repository);
  const inventoryUseCase = new CheckInventoryUseCase(
    repository,
    eventPublisher,
    createFeatureFlags(),
    logger
  );
  const paymentUseCase = new ProcessPaymentUseCase(
    repository,
    eventPublisher,
    logger
  );
  const fraudUseCase = new CheckFraudUseCase(
    repository,
    eventPublisher,
    createFeatureFlags(),
    logger
  );
  const shippingUseCase = new ProcessShippingUseCase(
    repository,
    eventPublisher,
    logger
  );
  const notificationUseCase = new SendNotificationUseCase(logger);

  const useRealLambdas = process.env.USE_REAL_LAMBDAS === 'true';
  const lambdaClient = useRealLambdas
    ? new LambdaClient(createLambdaClientConfig())
    : undefined;

  const invokeLambda = async (
    key: string,
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const response = await lambdaClient!.send(
      new InvokeCommand({
        FunctionName: `${resourcePrefix}-${key}`,
        Payload: Buffer.from(JSON.stringify(event))
      })
    );

    if (response.FunctionError) {
      return jsonResponse(500, {
        error: 'LAMBDA_INVOCATION_FAILED',
        message: response.FunctionError
      });
    }

    const payload = response.Payload
      ? (JSON.parse(
          Buffer.from(response.Payload).toString('utf8')
        ) as APIGatewayProxyStructuredResultV2)
      : jsonResponse(204, {});

    return payload;
  };

  const toApiGatewayEvent = (
    request: http.IncomingMessage,
    url: URL,
    body: string,
    pathParameters?: Record<string, string>
  ): APIGatewayProxyEventV2 => ({
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.replace(/^\?/, ''),
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(',') : (value ?? '')
      ])
    ),
    ...(pathParameters ? { pathParameters } : {}),
    requestContext: {
      accountId: '000000000000',
      apiId: 'local-api',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: crypto.randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method: request.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: request.headers['user-agent'] ?? 'local-shim'
      }
    },
    body,
    isBase64Encoded: false
  });

  const drainQueue = async (
    queueUrl: string,
    processor: (messageBody: string) => Promise<void>
  ): Promise<void> => {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1
      })
    );

    const messages = response.Messages ?? [];

    for (const message of messages) {
      if (!message.Body || !message.ReceiptHandle || !message.MessageId) {
        continue;
      }

      await processor(message.Body);

      await sqsClient.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: [
            {
              Id: message.MessageId,
              ReceiptHandle: message.ReceiptHandle
            }
          ]
        })
      );
    }
  };

  const publishOrderApproved = async (
    orderId: string,
    correlationId: string
  ): Promise<void> => {
    const event: EventEnvelope<OrderEventDetail> = {
      source: 'order.processing',
      detailType: 'OrderApproved',
      version: 'v1',
      correlationId,
      timestamp: new Date().toISOString(),
      detail: {
        orderId,
        status: 'APPROVED'
      }
    };

    await eventPublisher.publish(event);
  };

  const processOrderWorkflow = async (
    orderId: string,
    correlationId: string
  ): Promise<void> => {
    const inventoryResult = await inventoryUseCase.execute(
      orderId,
      correlationId
    );

    if (inventoryResult.inventoryStatus === 'OUT_OF_STOCK') {
      orderWorkflowOutcomesTotal.inc({ outcome: 'out_of_stock' });
      await queuePublisher.send(resources.notificationQueueUrl, {
        orderId,
        correlationId,
        channel: 'email',
        reason: 'Inventory unavailable.'
      });
      await drainQueue(resources.notificationQueueUrl, async (messageBody) => {
        await notificationUseCase.execute(toSqsEvent(messageBody));
      });
      return;
    }

    const paymentResult = await paymentUseCase.execute(orderId, correlationId);

    if (paymentResult.paymentStatus === 'FAILED') {
      orderWorkflowOutcomesTotal.inc({ outcome: 'payment_failed' });
      await queuePublisher.send(resources.notificationQueueUrl, {
        orderId,
        correlationId,
        channel: 'sms',
        reason: 'Payment failed.'
      });
      await drainQueue(resources.notificationQueueUrl, async (messageBody) => {
        await notificationUseCase.execute(toSqsEvent(messageBody));
      });
      return;
    }

    const fraudResult = await fraudUseCase.execute(orderId, correlationId);

    if (fraudResult.fraudStatus === 'REJECTED') {
      orderWorkflowOutcomesTotal.inc({ outcome: 'fraud_rejected' });
      await queuePublisher.send(resources.notificationQueueUrl, {
        orderId,
        correlationId,
        channel: 'push',
        reason: 'Fraud detected.'
      });
      await drainQueue(resources.notificationQueueUrl, async (messageBody) => {
        await notificationUseCase.execute(toSqsEvent(messageBody));
      });
      return;
    }

    orderWorkflowOutcomesTotal.inc({ outcome: 'approved' });
    await publishOrderApproved(orderId, correlationId);
    await queuePublisher.send(resources.shippingQueueUrl, {
      orderId,
      correlationId
    });
    await drainQueue(resources.shippingQueueUrl, async (messageBody) => {
      await shippingUseCase.execute(toSqsEvent(messageBody));
    });
  };

  const normalizeRoute = (pathname: string): string => {
    if (pathname.startsWith('/orders/')) {
      return '/orders/:id';
    }

    return pathname;
  };

  const handleRequest = async (
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> => {
    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`
    );
    const method = request.method ?? 'UNKNOWN';
    const route = normalizeRoute(url.pathname);
    const endTimer = httpRequestDurationSeconds.startTimer();

    response.once('finish', () => {
      endTimer({ method, route, status_code: String(response.statusCode) });
    });

    if (method === 'GET' && url.pathname === '/metrics') {
      response.writeHead(200, { 'content-type': registry.contentType });
      response.end(await registry.metrics());
      return;
    }

    try {
      if (useRealLambdas) {
        if (request.method === 'POST' && url.pathname === '/orders') {
          const rawBody = await readBody(request);
          const event = toApiGatewayEvent(request, url, rawBody);
          sendResponse(response, await invokeLambda('create-order', event));
          return;
        }

        if (request.method === 'GET' && url.pathname === '/orders') {
          const event = toApiGatewayEvent(request, url, '');
          sendResponse(response, await invokeLambda('list-orders', event));
          return;
        }

        if (url.pathname.startsWith('/orders/')) {
          const orderId = url.pathname.replace('/orders/', '');
          const event = toApiGatewayEvent(request, url, '', { id: orderId });

          if (request.method === 'GET') {
            sendResponse(response, await invokeLambda('get-order', event));
            return;
          }

          if (request.method === 'DELETE') {
            sendResponse(response, await invokeLambda('cancel-order', event));
            return;
          }
        }

        sendResponse(
          response,
          jsonResponse(404, {
            error: 'NOT_FOUND',
            message: 'Route not found.'
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/orders') {
        const rawBody = await readBody(request);

        if (!rawBody) {
          throw new ValidationError('Request body is required.');
        }

        const payload = parseCreateOrderPayload(rawBody);
        const correlationId =
          request.headers['x-correlation-id']?.toString().trim() ||
          crypto.randomUUID();
        const idempotencyKey =
          request.headers['idempotency-key']?.toString().trim() ||
          crypto.randomUUID();

        const result = await createOrderUseCase.execute({
          ...payload,
          correlationId,
          idempotencyKey
        });

        if (!result.reused) {
          ordersCreatedTotal.inc();
          void processOrderWorkflow(result.orderId, correlationId);
        }

        sendResponse(
          response,
          jsonResponse(result.reused ? 200 : 202, {
            orderId: result.orderId,
            status: result.status
          })
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/orders') {
        sendResponse(
          response,
          jsonResponse(200, await listOrdersUseCase.execute())
        );
        return;
      }

      if (url.pathname.startsWith('/orders/')) {
        const orderId = url.pathname.replace('/orders/', '');

        if (request.method === 'GET') {
          sendResponse(
            response,
            jsonResponse(200, await getOrderUseCase.execute(orderId))
          );
          return;
        }

        if (request.method === 'DELETE') {
          sendResponse(
            response,
            jsonResponse(200, await cancelOrderUseCase.execute(orderId))
          );
          return;
        }
      }

      sendResponse(
        response,
        jsonResponse(404, { error: 'NOT_FOUND', message: 'Route not found.' })
      );
    } catch (error) {
      sendResponse(response, errorResponse(error));
    }
  };

  const server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
};

const main = async (): Promise<void> => {
  const server = await startLocalServer();
  process.stdout.write(`Local server listening on port ${server.port}\n`);
};

if (require.main === module) {
  void main();
}

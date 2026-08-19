import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppError,
  FraudException,
  InventoryException,
  OrderNotFoundException,
  PaymentException,
  ValidationError
} from '../../src/shared/errors/app-errors';
import { orderStatuses } from '../../src/shared/domain/order';
import { PowertoolsStructuredLogger } from '../../src/shared/infrastructure/logger';
import {
  createDynamoDbClientConfig,
  createEventBridgeClientConfig,
  createIamClientConfig,
  createLambdaClientConfig,
  createSfnClientConfig,
  createSqsClientConfig,
  isLocalAwsRuntime
} from '../../src/shared/infrastructure/aws-client-config';
import {
  getCorrelationId,
  getIdempotencyKey
} from '../../src/shared/utils/correlation';
import { errorResponse, jsonResponse } from '../../src/shared/utils/http';
import {
  createOrderSchema,
  parseCreateOrderPayload
} from '../../src/shared/validation/order-schema';

describe('shared primitives', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOCAL_AWS_ENDPOINT;
    delete process.env.USE_LOCALSTACK;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.LOG_FILE_PATH;
  });

  afterEach(() => {
    Object.assign(process.env, envSnapshot);
  });

  it('exposes the supported order statuses', () => {
    expect(orderStatuses).toEqual([
      'RECEIVED',
      'PROCESSING',
      'APPROVED',
      'REJECTED',
      'OUT_OF_STOCK',
      'PAYMENT_FAILED',
      'FRAUD_DETECTED',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED'
    ]);
  });

  it('validates create order payloads', () => {
    expect(
      createOrderSchema.parse({
        customerId: 'customer-1',
        items: [{ productId: 'SKU-1', quantity: 2 }]
      })
    ).toEqual({
      customerId: 'customer-1',
      items: [{ productId: 'SKU-1', quantity: 2 }]
    });

    expect(() =>
      createOrderSchema.parse({
        customerId: '',
        items: []
      })
    ).toThrow();

    expect(
      createOrderSchema.parse({
        customerId: 'customer-1',
        items: Array.from({ length: 50 }, (_, index) => ({
          productId: `SKU-${index}`,
          quantity: 1
        }))
      }).items
    ).toHaveLength(50);

    expect(() =>
      createOrderSchema.parse({
        customerId: 'customer-1',
        items: Array.from({ length: 51 }, (_, index) => ({
          productId: `SKU-${index}`,
          quantity: 1
        }))
      })
    ).toThrow(/50/);
  });

  it('parses create order request bodies into ValidationError on failure', () => {
    expect(
      parseCreateOrderPayload(
        JSON.stringify({
          customerId: 'customer-1',
          items: [{ productId: 'SKU-1', quantity: 2 }]
        })
      )
    ).toEqual({
      customerId: 'customer-1',
      items: [{ productId: 'SKU-1', quantity: 2 }]
    });

    expect(() => parseCreateOrderPayload('{not-json')).toThrow(ValidationError);
    expect(() =>
      parseCreateOrderPayload(JSON.stringify({ items: [] }))
    ).toThrow(/customerId/);
    expect(() =>
      parseCreateOrderPayload(JSON.stringify('not-an-object'))
    ).toThrow(/^body:/);
  });

  it('reads correlation and idempotency headers and falls back to generated ids', () => {
    expect(
      getCorrelationId({ headers: { 'x-correlation-id': ' corr-1 ' } } as never)
    ).toBe('corr-1');
    expect(
      getIdempotencyKey({ headers: { 'Idempotency-Key': ' idem-1 ' } } as never)
    ).toBe('idem-1');
    expect(getCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(getIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('creates JSON success and error responses', () => {
    expect(jsonResponse(202, { ok: true })).toEqual({
      statusCode: 202,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({ ok: true })
    });

    expect(errorResponse(new ValidationError('bad request'))).toEqual({
      statusCode: 400,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'bad request'
      })
    });

    expect(errorResponse(new Error('boom'))).toEqual({
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected error while processing the request.'
      })
    });
  });

  it('exposes the expected application error metadata', () => {
    const appError = new AppError('base', 418, 'BASE');
    expect(appError.name).toBe('AppError');
    expect(appError.statusCode).toBe(418);
    expect(appError.code).toBe('BASE');

    expect(new InventoryException().code).toBe('INVENTORY_ERROR');
    expect(new PaymentException().statusCode).toBe(402);
    expect(new FraudException().statusCode).toBe(403);
    expect(new OrderNotFoundException('order-1').message).toBe(
      'Order order-1 was not found.'
    );
  });

  it('writes structured logs to stdout and stderr', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logger = new PowertoolsStructuredLogger('test-service');

    logger.addContext({ correlationId: 'corr-1', orderId: 'order-1' });
    logger.info('info message', { status: 'OK' });
    logger.info('info without metadata');
    logger.error('error message', { status: 'ERROR' });

    const infoEntry = JSON.parse(
      String(stdoutSpy.mock.calls[0]?.[0] ?? '')
    ) as Record<string, string>;
    const infoWithoutMetadata = JSON.parse(
      String(stdoutSpy.mock.calls[1]?.[0] ?? '')
    ) as Record<string, string>;
    const errorEntry = JSON.parse(
      String(stderrSpy.mock.calls[0]?.[0] ?? '')
    ) as Record<string, string>;

    expect(infoEntry.service).toBe('test-service');
    expect(infoEntry.correlationId).toBe('corr-1');
    expect(infoEntry.status).toBe('OK');
    expect(infoWithoutMetadata.message).toBe('info without metadata');
    expect(errorEntry.level).toBe('ERROR');
    expect(errorEntry.orderId).toBe('order-1');
  });

  it('also appends structured logs to a file when LOG_FILE_PATH is set', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const tempDir = mkdtempSync(join(tmpdir(), 'order-processing-logs-'));
    const logFilePath = join(tempDir, 'nested', 'local-server.log');
    process.env.LOG_FILE_PATH = logFilePath;

    try {
      const logger = new PowertoolsStructuredLogger('test-service');
      logger.info('written to file');

      const fileContent = readFileSync(logFilePath, 'utf8').trim();
      const entry = JSON.parse(fileContent) as Record<string, string>;

      expect(entry.message).toBe('written to file');
      expect(entry.service).toBe('test-service');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds local AWS client configuration only when LocalStack is enabled', () => {
    expect(isLocalAwsRuntime()).toBe(false);
    expect(createDynamoDbClientConfig()).toEqual({});
    expect(createEventBridgeClientConfig()).toEqual({});
    expect(createSqsClientConfig()).toEqual({});

    process.env.USE_LOCALSTACK = 'true';
    expect(createDynamoDbClientConfig()).toEqual({
      endpoint: 'http://localhost:4566',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
      }
    });

    process.env.LOCAL_AWS_ENDPOINT = 'http://localhost:4566';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'custom-access';
    process.env.AWS_SECRET_ACCESS_KEY = 'custom-secret';

    expect(isLocalAwsRuntime()).toBe(true);
    expect(createDynamoDbClientConfig()).toEqual({
      endpoint: 'http://localhost:4566',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'custom-access',
        secretAccessKey: 'custom-secret'
      }
    });
    expect(createEventBridgeClientConfig()).toEqual(
      createDynamoDbClientConfig()
    );
    expect(createSqsClientConfig()).toEqual(createDynamoDbClientConfig());
    expect(createLambdaClientConfig()).toEqual(createDynamoDbClientConfig());
    expect(createIamClientConfig()).toEqual(createDynamoDbClientConfig());
    expect(createSfnClientConfig()).toEqual(createDynamoDbClientConfig());
  });
});

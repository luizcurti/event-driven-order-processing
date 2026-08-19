import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startLocalServer } from '../../scripts/localstack/server';

interface LocalServerHandle {
  port: number;
  close(): Promise<void>;
}

const repoRoot = process.cwd();
let server: LocalServerHandle;

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const getJson = async <T>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: (await response.json()) as T
  };
};

const waitForOrderStatus = async (
  orderId: string,
  status: string
): Promise<Record<string, unknown>> => {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const response = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/${orderId}`
    );

    if (response.body.status === status) {
      return response.body;
    }

    await wait(250);
  }

  throw new Error(`Order ${orderId} did not reach status ${status}.`);
};

describe.sequential('LocalStack end-to-end flow', () => {
  beforeAll(async () => {
    try {
      execFileSync(
        'docker',
        ['compose', '-f', 'docker-compose.localstack.yml', 'down', '-v'],
        {
          cwd: repoRoot,
          stdio: 'ignore'
        }
      );
    } catch {
      // Ignore cleanup failures before the test environment starts.
    }

    execFileSync(
      'docker',
      ['compose', '-f', 'docker-compose.localstack.yml', 'up', '-d'],
      {
        cwd: repoRoot,
        stdio: 'inherit'
      }
    );

    server = await startLocalServer(3100);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }

    try {
      execFileSync(
        'docker',
        ['compose', '-f', 'docker-compose.localstack.yml', 'down', '-v'],
        {
          cwd: repoRoot,
          stdio: 'inherit'
        }
      );
    } catch {
      // Ignore teardown failures after test assertions complete.
    }
  });

  it('processes an approved order until delivered and reuses idempotent requests', async () => {
    const createResponse = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-approved',
          'idempotency-key': 'idem-approved'
        },
        body: JSON.stringify({
          customerId: 'customer-approved',
          items: [{ productId: 'SKU-1', quantity: 1 }]
        })
      }
    );

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.status).toBe('RECEIVED');

    const deliveredOrder = await waitForOrderStatus(
      createResponse.body.orderId,
      'DELIVERED'
    );
    expect(deliveredOrder.status).toBe('DELIVERED');

    const idempotentResponse = await getJson<{
      orderId: string;
      status: string;
    }>(`http://127.0.0.1:${server.port}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': 'corr-approved-2',
        'idempotency-key': 'idem-approved'
      },
      body: JSON.stringify({
        customerId: 'customer-approved',
        items: [{ productId: 'SKU-1', quantity: 1 }]
      })
    });

    expect(idempotentResponse.status).toBe(200);
    expect(idempotentResponse.body.orderId).toBe(createResponse.body.orderId);

    const listResponse = await getJson<Array<Record<string, unknown>>>(
      `http://127.0.0.1:${server.port}/orders`
    );
    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.some(
        (order) => order.id === createResponse.body.orderId
      )
    ).toBe(true);
  });

  it('marks an order as out of stock', async () => {
    const createResponse = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-out-of-stock',
          'idempotency-key': 'idem-out-of-stock'
        },
        body: JSON.stringify({
          customerId: 'customer-stock',
          items: [{ productId: 'SKU-2', quantity: 8 }]
        })
      }
    );

    expect(createResponse.status).toBe(202);
    expect(
      (await waitForOrderStatus(createResponse.body.orderId, 'OUT_OF_STOCK'))
        .status
    ).toBe('OUT_OF_STOCK');
  });

  it('marks payment failures and fraud rejections correctly', async () => {
    const paymentFailure = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-payment-failed',
          'idempotency-key': 'idem-payment-failed'
        },
        body: JSON.stringify({
          customerId: 'fail-payment-customer',
          items: [{ productId: 'SKU-3', quantity: 1 }]
        })
      }
    );
    const fraudRejected = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-fraud-rejected',
          'idempotency-key': 'idem-fraud-rejected'
        },
        body: JSON.stringify({
          customerId: 'fraud-customer',
          items: [{ productId: 'SKU-4', quantity: 1 }]
        })
      }
    );

    expect(
      (await waitForOrderStatus(paymentFailure.body.orderId, 'PAYMENT_FAILED'))
        .status
    ).toBe('PAYMENT_FAILED');
    expect(
      (await waitForOrderStatus(fraudRejected.body.orderId, 'FRAUD_DETECTED'))
        .status
    ).toBe('FRAUD_DETECTED');
  });

  it('cancels an order through the HTTP API', async () => {
    const createResponse = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-cancel',
          'idempotency-key': 'idem-cancel'
        },
        body: JSON.stringify({
          customerId: 'customer-cancel',
          items: [{ productId: 'SKU-5', quantity: 1 }]
        })
      }
    );

    const cancelResponse = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/${createResponse.body.orderId}`,
      {
        method: 'DELETE'
      }
    );

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.status).toBe('CANCELLED');
  });

  it('reads a created order back through GET /orders/{id}', async () => {
    const createResponse = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-get',
          'idempotency-key': 'idem-get'
        },
        body: JSON.stringify({
          customerId: 'customer-get',
          items: [{ productId: 'SKU-6', quantity: 1 }]
        })
      }
    );

    const getResponse = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/${createResponse.body.orderId}`
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.id).toBe(createResponse.body.orderId);
    expect(getResponse.body.customerId).toBe('customer-get');
  });

  it('rejects order creation with an invalid payload', async () => {
    const missingItems = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: 'customer-invalid', items: [] })
      }
    );

    expect(missingItems.status).toBe(400);
    expect(missingItems.body.error).toBe('VALIDATION_ERROR');

    const malformedJson = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json'
      }
    );

    expect(malformedJson.status).toBe(400);
    expect(malformedJson.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for get and cancel operations on an unknown order', async () => {
    const getResponse = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/does-not-exist`
    );
    expect(getResponse.status).toBe(404);
    expect(getResponse.body.error).toBe('ORDER_NOT_FOUND');

    const cancelResponse = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/does-not-exist`,
      { method: 'DELETE' }
    );
    expect(cancelResponse.status).toBe(404);
    expect(cancelResponse.body.error).toBe('ORDER_NOT_FOUND');
  });

  it('rejects cancelling an order that has already been delivered', async () => {
    const createResponse = await getJson<{ orderId: string; status: string }>(
      `http://127.0.0.1:${server.port}/orders`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-cancel-delivered',
          'idempotency-key': 'idem-cancel-delivered'
        },
        body: JSON.stringify({
          customerId: 'customer-cancel-delivered',
          items: [{ productId: 'SKU-7', quantity: 1 }]
        })
      }
    );

    await waitForOrderStatus(createResponse.body.orderId, 'DELIVERED');

    const cancelResponse = await getJson<Record<string, unknown>>(
      `http://127.0.0.1:${server.port}/orders/${createResponse.body.orderId}`,
      { method: 'DELETE' }
    );

    expect(cancelResponse.status).toBe(400);
    expect(cancelResponse.body.error).toBe('VALIDATION_ERROR');
  });
});

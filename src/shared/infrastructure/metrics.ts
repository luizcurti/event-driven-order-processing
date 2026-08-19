import client from 'prom-client';

export const registry = new client.Registry();

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of local HTTP API requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry]
});

export const ordersCreatedTotal = new client.Counter({
  name: 'orders_created_total',
  help: 'Total number of orders created',
  registers: [registry]
});

export const orderWorkflowOutcomesTotal = new client.Counter({
  name: 'order_workflow_outcomes_total',
  help: 'Total number of order workflow outcomes by result',
  labelNames: ['outcome'],
  registers: [registry]
});

export const enableDefaultMetrics = (): void => {
  client.collectDefaultMetrics({ register: registry });
};

export type InvocationOutcome = 'success' | 'error';

/**
 * Pushes per-invocation metrics for ephemeral Lambda executions, which can't
 * be scraped (pull-based) since the process exits right after the
 * invocation. No-ops unless PUSHGATEWAY_URL is set, so this has zero effect
 * when deployed to real AWS Lambda.
 */
export const pushInvocationMetrics = async (
  serviceName: string,
  durationSeconds: number,
  outcome: InvocationOutcome
): Promise<void> => {
  const pushgatewayUrl = process.env.PUSHGATEWAY_URL;

  if (!pushgatewayUrl) {
    return;
  }

  try {
    const pushRegistry = new client.Registry();

    new client.Counter({
      name: 'lambda_invocations_total',
      help: 'Total number of Lambda invocations by service and outcome',
      labelNames: ['service', 'outcome'],
      registers: [pushRegistry]
    }).inc({ service: serviceName, outcome });

    new client.Histogram({
      name: 'lambda_invocation_duration_seconds',
      help: 'Duration of Lambda invocations in seconds',
      labelNames: ['service'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [pushRegistry]
    }).observe({ service: serviceName }, durationSeconds);

    const pushgateway = new client.Pushgateway(
      pushgatewayUrl,
      {},
      pushRegistry
    );

    await pushgateway.pushAdd({ jobName: serviceName });
  } catch (error) {
    process.stderr.write(
      `Failed to push invocation metrics for ${serviceName}: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`
    );
  }
};

/**
 * Wraps a Lambda handler that doesn't go through withHttpHandler or
 * createStepHandler (raw SQS/EventBridge handlers) with the same
 * push-based invocation metrics.
 */
export const withInvocationMetrics = <TArgs extends unknown[], TResult>(
  serviceName: string,
  handler: (...args: TArgs) => Promise<TResult>
): ((...args: TArgs) => Promise<TResult>) => {
  return async (...args: TArgs): Promise<TResult> => {
    const startedAt = process.hrtime.bigint();

    try {
      const result = await handler(...args);

      await pushInvocationMetrics(
        serviceName,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
        'success'
      );

      return result;
    } catch (error) {
      await pushInvocationMetrics(
        serviceName,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
        'error'
      );

      throw error;
    }
  };
};

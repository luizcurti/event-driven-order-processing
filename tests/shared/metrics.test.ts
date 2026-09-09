import client from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  emitEmfMetric,
  enableDefaultMetrics,
  httpRequestDurationSeconds,
  orderWorkflowOutcomesTotal,
  ordersCreatedTotal,
  pushInvocationMetrics,
  registry,
  withInvocationMetrics
} from '../../src/shared/infrastructure/metrics';

describe('metrics', () => {
  it('exposes business and default metrics on the shared registry', async () => {
    enableDefaultMetrics();

    ordersCreatedTotal.inc();
    orderWorkflowOutcomesTotal.inc({ outcome: 'approved' });
    httpRequestDurationSeconds.observe(
      { method: 'GET', route: '/orders', status_code: '200' },
      0.05
    );

    const output = await registry.metrics();

    expect(output).toContain('orders_created_total 1');
    expect(output).toContain(
      'order_workflow_outcomes_total{outcome="approved"} 1'
    );
    expect(output).toContain('http_request_duration_seconds');
    expect(output).toContain('process_cpu_user_seconds_total');
  });

  describe('emitEmfMetric', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes a CloudWatch EMF log line to stdout', () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      emitEmfMetric('create-order', 0.25, 'success');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const writtenLine = stdoutSpy.mock.calls[0]?.[0] as string;
      const line = JSON.parse(writtenLine.trim()) as {
        _aws: { CloudWatchMetrics: [{ Namespace: string }] };
        Service: string;
        Outcome: string;
        InvocationCount: number;
        InvocationDuration: number;
      };

      expect(line._aws.CloudWatchMetrics[0].Namespace).toBe('OrderProcessing');
      expect(line.Service).toBe('create-order');
      expect(line.Outcome).toBe('success');
      expect(line.InvocationCount).toBe(1);
      expect(line.InvocationDuration).toBe(250);
    });
  });

  describe('pushInvocationMetrics', () => {
    afterEach(() => {
      delete process.env.PUSHGATEWAY_URL;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      vi.restoreAllMocks();
    });

    it('does nothing outside a Lambda runtime and without PUSHGATEWAY_URL (e.g. unit tests)', async () => {
      const pushAddSpy = vi.spyOn(client.Pushgateway.prototype, 'pushAdd');
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      await pushInvocationMetrics('create-order', 0.1, 'success');

      expect(pushAddSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('emits an EMF metric instead of pushing when running in Lambda without PUSHGATEWAY_URL', async () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'create-order';
      const pushAddSpy = vi.spyOn(client.Pushgateway.prototype, 'pushAdd');
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      await pushInvocationMetrics('create-order', 0.1, 'success');

      expect(pushAddSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });

    it('pushes invocation metrics to the gateway when configured', async () => {
      process.env.PUSHGATEWAY_URL = 'http://pushgateway:9091';
      const pushAddSpy = vi
        .spyOn(client.Pushgateway.prototype, 'pushAdd')
        .mockResolvedValue({});

      await pushInvocationMetrics('create-order', 0.25, 'success');

      expect(pushAddSpy).toHaveBeenCalledWith({ jobName: 'create-order' });
    });

    it('swallows push failures instead of throwing', async () => {
      process.env.PUSHGATEWAY_URL = 'http://pushgateway:9091';
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      vi.spyOn(client.Pushgateway.prototype, 'pushAdd').mockRejectedValueOnce(
        new Error('gateway unreachable')
      );
      await expect(
        pushInvocationMetrics('create-order', 0.25, 'error')
      ).resolves.toBeUndefined();

      vi.spyOn(client.Pushgateway.prototype, 'pushAdd').mockRejectedValueOnce(
        'not an error instance'
      );
      await expect(
        pushInvocationMetrics('create-order', 0.25, 'error')
      ).resolves.toBeUndefined();

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to push invocation metrics')
      );
    });
  });

  describe('withInvocationMetrics', () => {
    afterEach(() => {
      delete process.env.PUSHGATEWAY_URL;
      vi.restoreAllMocks();
    });

    it('pushes success metrics and returns the handler result', async () => {
      process.env.PUSHGATEWAY_URL = 'http://pushgateway:9091';
      const pushAddSpy = vi
        .spyOn(client.Pushgateway.prototype, 'pushAdd')
        .mockResolvedValue({});

      const wrapped = withInvocationMetrics('notification', () =>
        Promise.resolve('ok')
      );

      await expect(wrapped()).resolves.toBe('ok');
      expect(pushAddSpy).toHaveBeenCalledWith({ jobName: 'notification' });
    });

    it('pushes error metrics and rethrows when the handler fails', async () => {
      process.env.PUSHGATEWAY_URL = 'http://pushgateway:9091';
      const pushAddSpy = vi
        .spyOn(client.Pushgateway.prototype, 'pushAdd')
        .mockResolvedValue({});

      const wrapped = withInvocationMetrics(
        'notification',
        (): Promise<void> => {
          throw new Error('boom');
        }
      );

      await expect(wrapped()).rejects.toThrow('boom');
      expect(pushAddSpy).toHaveBeenCalledWith({ jobName: 'notification' });
    });
  });
});

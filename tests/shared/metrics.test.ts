import client from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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

  describe('pushInvocationMetrics', () => {
    afterEach(() => {
      delete process.env.PUSHGATEWAY_URL;
      vi.restoreAllMocks();
    });

    it('does nothing when PUSHGATEWAY_URL is not set', async () => {
      const pushAddSpy = vi.spyOn(client.Pushgateway.prototype, 'pushAdd');

      await pushInvocationMetrics('create-order', 0.1, 'success');

      expect(pushAddSpy).not.toHaveBeenCalled();
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

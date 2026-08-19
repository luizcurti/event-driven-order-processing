import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2
} from 'aws-lambda';

import type { StructuredLogger } from '../application/ports';

import { AppError } from '../errors/app-errors';
import { pushInvocationMetrics } from '../infrastructure/metrics';
import { getCorrelationId } from './correlation';

export const jsonResponse = (
  statusCode: number,
  body: unknown
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  },
  body: JSON.stringify(body)
});

export const errorResponse = (
  error: unknown
): APIGatewayProxyStructuredResultV2 => {
  if (error instanceof AppError) {
    return jsonResponse(error.statusCode, {
      error: error.code,
      message: error.message
    });
  }

  return jsonResponse(500, {
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected error while processing the request.'
  });
};

/**
 * Wraps an API Gateway operation, applying the shared boilerplate of
 * correlation id propagation, logging context and standardized error handling.
 */
export const withHttpHandler = (
  logger: StructuredLogger,
  operationName: string,
  execute: (
    event: APIGatewayProxyEventV2,
    correlationId: string
  ) => Promise<APIGatewayProxyStructuredResultV2>
): APIGatewayProxyHandlerV2 => {
  const serviceName = operationName.replace(/\s+/g, '-');

  return async (event) => {
    const correlationId = getCorrelationId(event);
    const startedAt = process.hrtime.bigint();

    logger.addContext({
      correlationId,
      requestId: event.requestContext.requestId ?? 'unknown'
    });

    try {
      const result = await execute(event, correlationId);

      await pushInvocationMetrics(
        serviceName,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
        'success'
      );

      return result;
    } catch (error) {
      logger.error(`Failed to ${operationName}.`, {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown'
      });

      await pushInvocationMetrics(
        serviceName,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
        'error'
      );

      return errorResponse(error);
    }
  };
};

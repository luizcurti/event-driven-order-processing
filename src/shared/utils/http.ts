import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { AppError } from '../errors/app-errors';

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

export interface LambdaFunctionConfig {
  key: string;
  entry: string;
  timeoutSeconds: number;
}

/**
 * Mirrors `local.lambda_config` in terraform/environments/dev/main.tf so the
 * local LocalStack deployment matches the real Lambda topology.
 */
export const lambdaFunctions: LambdaFunctionConfig[] = [
  {
    key: 'create-order',
    entry: 'src/create-order/handler/index.ts',
    timeoutSeconds: 15
  },
  {
    key: 'get-order',
    entry: 'src/orders/handler/get-order.ts',
    timeoutSeconds: 10
  },
  {
    key: 'list-orders',
    entry: 'src/orders/handler/list-orders.ts',
    timeoutSeconds: 10
  },
  {
    key: 'cancel-order',
    entry: 'src/orders/handler/cancel-order.ts',
    timeoutSeconds: 10
  },
  {
    key: 'inventory',
    entry: 'src/inventory/handler/index.ts',
    timeoutSeconds: 15
  },
  {
    key: 'payment',
    entry: 'src/payment/handler/index.ts',
    timeoutSeconds: 15
  },
  {
    key: 'fraud',
    entry: 'src/fraud/handler/index.ts',
    timeoutSeconds: 15
  },
  {
    key: 'shipping',
    entry: 'src/shipping/handler/index.ts',
    timeoutSeconds: 30
  },
  {
    key: 'notification',
    entry: 'src/notification/handler/index.ts',
    timeoutSeconds: 30
  },
  {
    key: 'update-order',
    entry: 'src/update-order/handler/index.ts',
    timeoutSeconds: 15
  }
];

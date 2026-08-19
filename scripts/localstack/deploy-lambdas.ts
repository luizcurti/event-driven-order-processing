import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  ListEventSourceMappingsCommand,
  ResourceConflictException,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand
} from '@aws-sdk/client-lambda';
import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand
} from '@aws-sdk/client-eventbridge';
import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  NoSuchEntityException,
  PutRolePolicyCommand
} from '@aws-sdk/client-iam';
import {
  CreateStateMachineCommand,
  DescribeStateMachineCommand,
  SFNClient,
  StateMachineDoesNotExist,
  UpdateStateMachineCommand
} from '@aws-sdk/client-sfn';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

import {
  createEventBridgeClientConfig,
  createIamClientConfig,
  createLambdaClientConfig,
  createSfnClientConfig,
  createSqsClientConfig
} from '../../src/shared/infrastructure/aws-client-config';
import {
  ensureLocalstackResources,
  resourcePrefix,
  type LocalstackResources
} from './bootstrap';
import { lambdaFunctions } from './lambda-config';
import { packageLambdas } from './package-lambdas';

const region = process.env.AWS_REGION ?? 'us-east-1';
const roleName = `${resourcePrefix}-lambda-role`;
const lambdaInternalEndpoint =
  process.env.LAMBDA_INTERNAL_AWS_ENDPOINT ?? 'http://localstack:4566';
const pushgatewayInternalUrl =
  process.env.PUSHGATEWAY_INTERNAL_URL ?? 'http://pushgateway:9091';

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const functionName = (key: string): string => `${resourcePrefix}-${key}`;

const ensureLambdaRole = async (iamClient: IAMClient): Promise<string> => {
  const assumeRolePolicyDocument = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: [
            'lambda.amazonaws.com',
            'events.amazonaws.com',
            'states.amazonaws.com'
          ]
        },
        Action: 'sts:AssumeRole'
      }
    ]
  });

  try {
    const existing = await iamClient.send(
      new GetRoleCommand({ RoleName: roleName })
    );
    const arn = existing.Role?.Arn;

    if (arn) {
      return arn;
    }
  } catch (error) {
    if (!(error instanceof NoSuchEntityException)) {
      throw error;
    }
  }

  const created = await iamClient.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: assumeRolePolicyDocument
    })
  );

  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: `${roleName}-permissive`,
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }]
      })
    })
  );

  if (!created.Role?.Arn) {
    throw new Error('LocalStack did not return an ARN for the Lambda role.');
  }

  return created.Role.Arn;
};

const waitForFunctionActive = async (
  lambdaClient: LambdaClient,
  name: string
): Promise<void> => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = await lambdaClient.send(
      new GetFunctionCommand({ FunctionName: name })
    );

    if (result.Configuration?.State !== 'Pending') {
      return;
    }

    await wait(500);
  }
};

const environmentVariablesFor = (
  resources: LocalstackResources
): Record<string, string> => ({
  ORDERS_TABLE_NAME: resources.tableName,
  EVENT_BUS_NAME: resources.eventBusName,
  FEATURE_INVENTORY_CHECK: 'true',
  FEATURE_FRAUD_CHECK: 'true',
  USE_LOCALSTACK: 'true',
  LOCAL_AWS_ENDPOINT: lambdaInternalEndpoint,
  AWS_REGION: region,
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  PUSHGATEWAY_URL: pushgatewayInternalUrl
});

const deployFunction = async (
  lambdaClient: LambdaClient,
  key: string,
  timeoutSeconds: number,
  zipPath: string,
  roleArn: string,
  environment: Record<string, string>
): Promise<string> => {
  const name = functionName(key);
  const zipFile = readFileSync(zipPath);

  try {
    await lambdaClient.send(new GetFunctionCommand({ FunctionName: name }));

    await lambdaClient.send(
      new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zipFile })
    );
    await waitForFunctionActive(lambdaClient, name);

    const updated = await lambdaClient.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: name,
        Role: roleArn,
        Timeout: timeoutSeconds,
        Environment: { Variables: environment }
      })
    );
    await waitForFunctionActive(lambdaClient, name);

    if (!updated.FunctionArn) {
      throw new Error(`LocalStack did not return an ARN for ${name}.`);
    }

    return updated.FunctionArn;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    const created = await lambdaClient.send(
      new CreateFunctionCommand({
        FunctionName: name,
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        Role: roleArn,
        Timeout: timeoutSeconds,
        MemorySize: 256,
        Code: { ZipFile: zipFile },
        Environment: { Variables: environment }
      })
    );
    await waitForFunctionActive(lambdaClient, name);

    if (!created.FunctionArn) {
      throw new Error(`LocalStack did not return an ARN for ${name}.`);
    }

    return created.FunctionArn;
  }
};

const ensureEventSourceMapping = async (
  lambdaClient: LambdaClient,
  queueArn: string,
  targetFunctionArn: string
): Promise<void> => {
  const existing = await lambdaClient.send(
    new ListEventSourceMappingsCommand({
      EventSourceArn: queueArn,
      FunctionName: targetFunctionArn
    })
  );

  if ((existing.EventSourceMappings ?? []).length > 0) {
    return;
  }

  try {
    await lambdaClient.send(
      new CreateEventSourceMappingCommand({
        EventSourceArn: queueArn,
        FunctionName: targetFunctionArn,
        BatchSize: 10
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceConflictException)) {
      throw error;
    }
  }
};

const queueArnFor = async (
  sqsClient: SQSClient,
  queueUrl: string
): Promise<string> => {
  const attributes = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['QueueArn']
    })
  );

  const arn = attributes.Attributes?.QueueArn;

  if (!arn) {
    throw new Error(`LocalStack did not return an ARN for queue ${queueUrl}.`);
  }

  return arn;
};

const ensureEventBridgeRouting = async (
  eventBridgeClient: EventBridgeClient,
  resources: LocalstackResources,
  stateMachineArn: string,
  roleArn: string,
  shippingQueueArn: string,
  notificationQueueArn: string
): Promise<void> => {
  const busName = resources.eventBusName;

  const failureRules: Array<{ id: string; detailType: string }> = [
    { id: 'inventory-failed', detailType: 'InventoryFailed' },
    { id: 'payment-failed', detailType: 'PaymentFailed' },
    { id: 'fraud-rejected', detailType: 'FraudRejected' }
  ];

  await eventBridgeClient.send(
    new PutRuleCommand({
      Name: 'order-created',
      EventBusName: busName,
      EventPattern: JSON.stringify({
        source: ['order.processing'],
        'detail-type': ['OrderCreated']
      })
    })
  );
  await eventBridgeClient.send(
    new PutTargetsCommand({
      Rule: 'order-created',
      EventBusName: busName,
      Targets: [
        {
          Id: 'start-order-processing',
          Arn: stateMachineArn,
          RoleArn: roleArn
        }
      ]
    })
  );

  for (const rule of failureRules) {
    await eventBridgeClient.send(
      new PutRuleCommand({
        Name: rule.id,
        EventBusName: busName,
        EventPattern: JSON.stringify({
          source: ['order.processing'],
          'detail-type': [rule.detailType]
        })
      })
    );
    await eventBridgeClient.send(
      new PutTargetsCommand({
        Rule: rule.id,
        EventBusName: busName,
        Targets: [
          {
            Id: `${rule.id}-notification`,
            Arn: notificationQueueArn,
            InputTransformer: {
              InputPathsMap: {
                orderId: '$.detail.detail.orderId',
                correlationId: '$.detail.correlationId',
                reason: '$.detail.detail.reason'
              },
              InputTemplate:
                '{"orderId": <orderId>, "correlationId": <correlationId>, "reason": <reason>}'
            }
          }
        ]
      })
    );
  }

  await eventBridgeClient.send(
    new PutRuleCommand({
      Name: 'order-approved',
      EventBusName: busName,
      EventPattern: JSON.stringify({
        source: ['order.processing'],
        'detail-type': ['OrderApproved']
      })
    })
  );
  await eventBridgeClient.send(
    new PutTargetsCommand({
      Rule: 'order-approved',
      EventBusName: busName,
      Targets: [
        {
          Id: 'shipping-order',
          Arn: shippingQueueArn,
          InputTransformer: {
            InputPathsMap: {
              orderId: '$.detail.detail.orderId',
              correlationId: '$.detail.correlationId'
            },
            InputTemplate:
              '{"orderId": <orderId>, "correlationId": <correlationId>}'
          }
        }
      ]
    })
  );
};

const ensureStateMachine = async (
  sfnClient: SFNClient,
  resources: LocalstackResources,
  roleArn: string,
  functionArns: Map<string, string>
): Promise<string> => {
  const name = `${resourcePrefix}-order-processing`;
  const accountId = '000000000000';
  const stateMachineArn = `arn:aws:states:${region}:${accountId}:stateMachine:${name}`;

  const template = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'terraform',
      'environments',
      'dev',
      'order-processing.asl.json.tpl'
    ),
    'utf8'
  );

  const inventoryArn = functionArns.get('inventory');
  const paymentArn = functionArns.get('payment');
  const fraudArn = functionArns.get('fraud');

  if (!inventoryArn || !paymentArn || !fraudArn) {
    throw new Error(
      'Missing inventory/payment/fraud Lambda ARNs for the state machine definition.'
    );
  }

  const definition = template
    .replaceAll('${inventory_lambda_arn}', inventoryArn)
    .replaceAll('${payment_lambda_arn}', paymentArn)
    .replaceAll('${fraud_lambda_arn}', fraudArn)
    .replaceAll('${event_bus_name}', resources.eventBusName);

  try {
    await sfnClient.send(new DescribeStateMachineCommand({ stateMachineArn }));

    await sfnClient.send(
      new UpdateStateMachineCommand({
        stateMachineArn,
        definition,
        roleArn
      })
    );

    return stateMachineArn;
  } catch (error) {
    if (!(error instanceof StateMachineDoesNotExist)) {
      throw error;
    }

    const created = await sfnClient.send(
      new CreateStateMachineCommand({
        name,
        definition,
        roleArn,
        type: 'STANDARD'
      })
    );

    if (!created.stateMachineArn) {
      throw new Error('LocalStack did not return a state machine ARN.');
    }

    return created.stateMachineArn;
  }
};

export const deployLambdaInfrastructure = async (): Promise<void> => {
  const resources = await ensureLocalstackResources();

  const iamClient = new IAMClient(createIamClientConfig());
  const lambdaClient = new LambdaClient(createLambdaClientConfig());
  const eventBridgeClient = new EventBridgeClient(
    createEventBridgeClientConfig()
  );
  const sfnClient = new SFNClient(createSfnClientConfig());
  const sqsClient = new SQSClient(createSqsClientConfig());

  const roleArn = await ensureLambdaRole(iamClient);
  const environment = environmentVariablesFor(resources);

  const zipPathByKey = await packageLambdas();
  const functionArns = new Map<string, string>();

  for (const { key, timeoutSeconds } of lambdaFunctions) {
    const zipPath = zipPathByKey.get(key);

    if (!zipPath) {
      throw new Error(`Missing packaged bundle for ${key}.`);
    }

    const arn = await deployFunction(
      lambdaClient,
      key,
      timeoutSeconds,
      zipPath,
      roleArn,
      environment
    );

    functionArns.set(key, arn);
  }

  const stateMachineArn = await ensureStateMachine(
    sfnClient,
    resources,
    roleArn,
    functionArns
  );

  const shippingQueueArn = await queueArnFor(
    sqsClient,
    resources.shippingQueueUrl
  );
  const notificationQueueArn = await queueArnFor(
    sqsClient,
    resources.notificationQueueUrl
  );

  await ensureEventBridgeRouting(
    eventBridgeClient,
    resources,
    stateMachineArn,
    roleArn,
    shippingQueueArn,
    notificationQueueArn
  );

  const shippingArn = functionArns.get('shipping');
  const notificationArn = functionArns.get('notification');

  if (!shippingArn || !notificationArn) {
    throw new Error('Missing shipping/notification Lambda ARNs.');
  }

  await ensureEventSourceMapping(lambdaClient, shippingQueueArn, shippingArn);
  await ensureEventSourceMapping(
    lambdaClient,
    notificationQueueArn,
    notificationArn
  );

  process.stdout.write(
    `Deployed ${functionArns.size} Lambda functions, state machine ${stateMachineArn} and EventBridge routing.\n`
  );
};

if (require.main === module) {
  void deployLambdaInfrastructure();
}

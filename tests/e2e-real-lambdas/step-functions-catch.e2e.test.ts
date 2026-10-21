import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DescribeExecutionCommand,
  SFNClient,
  StartExecutionCommand
} from '@aws-sdk/client-sfn';
import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import {
  createSfnClientConfig,
  createSqsClientConfig
} from '../../src/shared/infrastructure/aws-client-config';
import { deployLambdaInfrastructure } from '../../scripts/localstack/deploy-lambdas';

const repoRoot = process.cwd();

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

// LocalStack's per-invocation Lambda containers (one per cold start) can
// outlive `docker compose down` -- a known quirk documented in the
// README's Troubleshooting section. Harmless on CI's ephemeral runners,
// but left unattended it accumulates stray containers across repeated
// local runs of this suite, so clean them up explicitly.
const removeStrayLambdaContainers = (): void => {
  try {
    const ids = execFileSync('docker', [
      'ps',
      '-aq',
      '--filter',
      'name=localstack-lambda-'
    ])
      .toString()
      .trim();

    if (ids) {
      execFileSync('docker', ['rm', '-f', ...ids.split('\n')]);
    }
  } catch {
    // Best-effort cleanup only.
  }
};

interface WorkflowFailureMessage {
  detail: { correlationId: string; detail: { orderId: string } };
  error: { Error: string; Cause: string };
}

describe.sequential('Step Functions Catch -> dead-letter queue', () => {
  let stateMachineArn: string;
  let dlqUrl: string;
  let sfnClient: SFNClient;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    try {
      execFileSync(
        'docker',
        ['compose', '-f', 'docker-compose.localstack.yml', 'down', '-v'],
        { cwd: repoRoot, stdio: 'ignore' }
      );
    } catch {
      // Ignore cleanup failures before the test environment starts.
    }
    removeStrayLambdaContainers();

    execFileSync(
      'docker',
      ['compose', '-f', 'docker-compose.localstack.yml', 'up', '-d'],
      { cwd: repoRoot, stdio: 'inherit' }
    );

    // Deploys the real bundled Lambda handlers, the real Step Functions
    // state machine (built from the same order-processing.asl.json.tpl
    // Terraform uses) and real EventBridge/SQS routing into LocalStack --
    // the "full production-topology fidelity" mode described in the
    // README, needed here because the direct-call shim used by the
    // default E2E suite (tests/e2e/) bypasses Step Functions entirely and
    // can't exercise its Catch/Retry branches.
    const deployed = await deployLambdaInfrastructure();
    stateMachineArn = deployed.stateMachineArn;
    dlqUrl = deployed.resources.deadLetterQueueUrl;

    sfnClient = new SFNClient(createSfnClientConfig());
    sqsClient = new SQSClient(createSqsClientConfig());
  }, 180000);

  afterAll(() => {
    removeStrayLambdaContainers();
    try {
      execFileSync(
        'docker',
        ['compose', '-f', 'docker-compose.localstack.yml', 'down', '-v'],
        { cwd: repoRoot, stdio: 'inherit' }
      );
    } catch {
      // Ignore teardown failures after test assertions complete.
    }
  });

  it('forwards an unhandled step failure to the dead-letter queue and fails the execution', async () => {
    const correlationId = `catch-branch-${Date.now()}`;
    const orderId = `does-not-exist-${Date.now()}`;

    // CheckInventory looks this order up and throws InventoryException when
    // it isn't found -- a genuine unhandled application error, not a
    // business rejection like OUT_OF_STOCK. Its error name doesn't match
    // the Retry block's Lambda-service error types, so the workflow skips
    // retries and hits Catch immediately instead of waiting through three
    // exponential backoffs.
    const started = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify({
          detail: { correlationId, detail: { orderId } }
        })
      })
    );

    let status: string | undefined = 'RUNNING';
    for (let attempt = 1; attempt <= 30 && status === 'RUNNING'; attempt += 1) {
      await wait(1000);
      const describeResult = await sfnClient.send(
        new DescribeExecutionCommand({ executionArn: started.executionArn })
      );
      status = describeResult.status;
    }

    expect(status).toBe('FAILED');

    let matchingMessage: WorkflowFailureMessage | undefined;
    for (let attempt = 1; attempt <= 10 && !matchingMessage; attempt += 1) {
      const received = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2
        })
      );

      matchingMessage = (received.Messages ?? [])
        .map(
          (message) =>
            JSON.parse(message.Body ?? '{}') as WorkflowFailureMessage
        )
        .find((body) => body.detail?.detail?.orderId === orderId);
    }

    expect(matchingMessage).toBeDefined();
    expect(matchingMessage?.detail.correlationId).toBe(correlationId);
    expect(matchingMessage?.error.Error).toBe('InventoryException');
  });
});

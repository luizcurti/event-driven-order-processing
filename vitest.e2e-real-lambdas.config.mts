import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e-real-lambdas/**/*.test.ts'],
    fileParallelism: false,
    // Packaging and deploying 10 real Lambdas plus the Step Functions
    // state machine into LocalStack (deployLambdaInfrastructure) is much
    // slower than the direct-call shim the default E2E suite (vitest.e2e.config.mts)
    // uses, hence the longer timeouts than that config's.
    testTimeout: 180000,
    hookTimeout: 180000
  }
});

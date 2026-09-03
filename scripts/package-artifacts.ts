import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { packageLambdas } from './localstack/package-lambdas';

const rootDir = join(__dirname, '..');
const artifactsDir = join(rootDir, 'artifacts');

/**
 * Builds the same esbuild-bundled Lambda zips used for LocalStack and copies
 * them into artifacts/, the layout terraform/environments/{dev,prod}/main.tf
 * expects for real deploys (each zip contains a single index.js bundle,
 * matching the "index.handler" entry point configured there).
 */
const main = async (): Promise<void> => {
  mkdirSync(artifactsDir, { recursive: true });

  const zips = await packageLambdas();

  for (const [key, zipPath] of zips) {
    copyFileSync(zipPath, join(artifactsDir, `${key}.zip`));
  }

  process.stdout.write(
    `Copied ${zips.size} Lambda artifacts into ${artifactsDir}\n`
  );
};

void main();

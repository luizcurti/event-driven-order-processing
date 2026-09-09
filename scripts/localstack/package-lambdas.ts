import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import * as esbuild from 'esbuild';

import { lambdaFunctions } from './lambda-config';

const rootDir = join(__dirname, '..', '..');
const outDir = join(rootDir, 'dist', 'lambda-bundles');
const zipDir = join(rootDir, 'dist', 'lambda-zips');

export const packageLambdas = async (): Promise<Map<string, string>> => {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(zipDir, { recursive: true });

  const zipPathByKey = new Map<string, string>();

  for (const { key, entry } of lambdaFunctions) {
    const bundlePath = join(outDir, `${key}.js`);

    await esbuild.build({
      entryPoints: [join(rootDir, entry)],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: false,
      logLevel: 'silent'
    });

    const zip = new AdmZip();
    zip.addLocalFile(bundlePath, '', 'index.js');

    const zipPath = join(zipDir, `${key}.zip`);
    zip.writeZip(zipPath);
    zipPathByKey.set(key, zipPath);
  }

  return zipPathByKey;
};

const main = async (): Promise<void> => {
  const zips = await packageLambdas();
  process.stdout.write(`Packaged ${zips.size} Lambda bundles into ${zipDir}\n`);
};

if (require.main === module) {
  void main();
}

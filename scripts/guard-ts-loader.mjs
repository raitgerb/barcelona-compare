// Node ESM load hook: transpile the Functions TypeScript with the esbuild copy
// that ships inside the cached wrangler install — Node's built-in "strip-only"
// stripping rejects full TS syntax (e.g. constructor parameter properties) used
// by functions/_lib/*. No install, no network.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ESBUILD = process.env.ESBUILD_PATH
  || '/Users/agrippa/.npm/_npx/32026684e21afda6/node_modules/esbuild/lib/main.js';

const esbuild = await import(ESBUILD);

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { code } = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

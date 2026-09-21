// Node ESM resolve hook: the Functions bundle uses extensionless relative
// imports (the wrangler/esbuild bundler resolves them). Node does not, so this
// hook re-tries '.ts' then '.js' for extensionless relative specifiers.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of ['.ts', '.js']) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        /* try the next extension */
      }
    }
  }
  return nextResolve(specifier, context);
}

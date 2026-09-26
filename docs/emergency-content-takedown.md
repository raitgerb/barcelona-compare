# Emergency content takedown

## Policy

A public listing that must be withdrawn immediately may use a direct Cloudflare
Pages deployment of the exact, locally built `dist/` output when the normal
Git-connected Pages build is unavailable.

This exception is deliberately narrow:

- The source change must already be committed on a named branch.
- The local production build must pass.
- The deployment must use `dist/`, never the repository root.
- No data collection, schema migration, dependency change or unrelated content
  change is permitted in the emergency artifact.
- Verify the deployed Pages deployment and the live URL before reporting success.
- The source PR remains required afterward so the Git-connected project returns
  to the canonical state.

This is an emergency publication path, not a general replacement for the
normal reviewed-PR deployment path.

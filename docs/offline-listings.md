# Taking a listing offline

A listing is taken offline without deleting its source file, photos, or other data.

From the repository root:

```bash
python3 scripts/listing-visibility.py nails <slug> offline
python3 scripts/listing-visibility.py massage <slug> offline
```

To restore a listing:

```bash
python3 scripts/listing-visibility.py nails <slug> online
python3 scripts/listing-visibility.py massage <slug> online
```

The `offline: true` frontmatter flag is excluded from every public catalogue query,
including category pages, neighbourhood pages, recommendations, search JSON,
claim-index JSON, detail routes and the sitemap. The former detail path is not
generated, so it returns a real 404 instead of a soft 404 page.

This is a source-controlled operation: after changing the flag, build and deploy
the site through the normal pull-request path. Do not delete the markdown file or
its R2 photos. The listing can be restored by changing the state back to `online`.

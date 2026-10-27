# Contributing

## Development

```sh
pnpm test        # store, stack, integration and type tests
pnpm typecheck
pnpm build       # ESM, CJS and .d.ts for the index and stack entries
pnpm demo        # Vite demo with forms, a confirm dialog, a context menu and stacked toasts
pnpm lint:pkg    # publint and are-the-types-wrong on the packed tarball
```

## Releasing

```sh
npm version patch        # bumps package.json and jsr.json, commits, and tags vX.Y.Z
git push --follow-tags   # the Release workflow publishes to npm and JSR
```

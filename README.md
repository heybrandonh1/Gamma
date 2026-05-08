# Gamma

The house for AI-collaborated experiments, ideas, and concepts. Each subfolder is its own self-contained playground.

## Subfolders

### `three-js-vibes/`

Tiny three.js scenes meant to be embedded as live cards in a portfolio (or anywhere else). Each vibe is a single React component that takes asset URLs as props and disposes cleanly on unmount.

Current vibes:

- **`disco-dancer/`** — A Mixamo dancer holding a glowing golden key, wearing a party hat, on a subtle multi-color disco floor. Loops a samba and crossfades into a breakdance burst from time to time.

## How Gamma is consumed

Most projects pull Gamma in as a git submodule:

```bash
git submodule add https://github.com/heybrandonh1/Gamma.git vendor/gamma
```

Then add a path alias in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@gamma/*": ["./vendor/gamma/*"]
    }
  }
}
```

And import:

```tsx
import { DiscoDancer } from "@gamma/three-js-vibes/disco-dancer";
```

The host app is responsible for serving any binary assets (FBXs, textures) from its own static folder and passing the URLs in as props. Gamma never assumes a specific public path.

## Adding a new vibe

1. Create a new folder under the appropriate root (e.g. `three-js-vibes/my-vibe/`).
2. Add `index.ts` re-exporting the public component(s) and types.
3. Document props in a colocated `README.md`.
4. Drop any binary assets in `<vibe>/assets/`.
5. Update this top-level README's "Current vibes" list.

## Peer dependencies

The vibes are written against:

- `react` >= 18
- `three` >= 0.180
- `@types/three`

The host app needs all three.

## License

MIT — see [LICENSE](./LICENSE).

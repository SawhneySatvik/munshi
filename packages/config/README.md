# @munshi/config

The one config module, and the only reader of `process.env`. Every setting's name is in
[`.env.example`](../../.env.example).

## Entry points

| Export | What |
|---|---|
| `webConfig()` | The web app's settings, checked at boot: each pool's URL, the deployment kind, secrets of the right length, and settings that must come together (all of WhatsApp's or none) |
| `channelSettings()` | WhatsApp and Instagram settings and approved template wording, if complete |
| `paypalSettings()` | `recorded`, or `sandbox` with all three PayPal settings; any other environment is refused |
| `tickSettings()` | The jobs tick's secret and connection |
| `POOLS`, `POOL_URL` | The six runtime pools and the variable each reads |
| `envPresence()` | Names and set or unset, never values |

All in [`src/index.ts`](src/index.ts).

## Boundaries

- Errors name a setting, never its value. A caught error is never wrapped or kept as a cause, so a secret cannot ride
  along in a message or a stack.
- Nothing here reads a file; `pnpm dev` passes its generated secrets in as environment variables.

## Testing

```bash
pnpm --filter @munshi/config test
```

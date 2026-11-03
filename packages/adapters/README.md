# @munshi/adapters

Small ports to the outside world, each with a recorded or local implementation so that nothing needs a network to
run or test.

| Subpath | What | Implementations |
|---|---|---|
| [`@munshi/adapters/channels`](channels/index.ts) | Outbound messages and webhook parsing | WhatsApp Cloud API ([`whatsapp.ts`](channels/whatsapp.ts)), Instagram Graph ([`instagram.ts`](channels/instagram.ts)), recorded ([`recorded.ts`](channels/recorded.ts): ids and body hashes only) |
| [`@munshi/adapters/payments`](payments/index.ts) | PayPal (sandbox): payment links, status, webhook verification | [`paypal.ts`](payments/paypal.ts); recorded mode without keys |
| [`@munshi/adapters/identity`](identity/index.ts) | Sign-in identities | Password (scrypt, per-pair lockout: [`password.ts`](identity/password.ts)), Supabase email verification ([`supabase-email.ts`](identity/supabase-email.ts)) |
| [`@munshi/adapters/cache`](cache/index.ts) | Strings by key with a time to live | In-process memory; Redis over a socket (no client library, no TLS) |
| [`@munshi/adapters/media`](media/index.ts) | Uploaded pictures' bytes by storage key | A local folder; Supabase Storage (one private bucket) |
| [`@munshi/adapters/botcheck`](botcheck/index.ts) | Verifying a public form's challenge token | Recorded only |

## Boundaries

- An adapter holds no domain rule. Core decides what is sent, cached or stored; an adapter only carries it.
- Webhook signatures are verified over the raw body, timing-safe, before anything is parsed.
- A slow or failed cache never breaks a request: the call rejects, and core reads PostgreSQL instead.
- A media store is trusted to hold bytes, never to vouch for them: whoever serves bytes checks them against the
  sha256 the database holds. A key outside a shop's own path is refused before any file or request.

## Testing

```bash
pnpm --filter @munshi/adapters test
```

Tests use local fakes shaped like each service's HTTP API (and a local `redis-server` when one is installed); none
calls a real service. The channel adapters are exercised end to end in [`db/test/v2/core`](../../db/test/v2/core).

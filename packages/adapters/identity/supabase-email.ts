// Email verification through Supabase Auth: a real shop's owner proves the mailbox before the shop is made. Supabase
// only sends the link and vouches for the email; the person's identity stays the password identity (idp), made with
// verified_via 'email' and only the email's HMAC. Two calls on Supabase Auth's REST API, with the project's publishable
// key: `sendLink` asks for a one-time link to `redirectTo` (POST /auth/v1/otp, the account made if new), and `verify`
// spends the link's token hash (POST /auth/v1/verify, type email) and returns the email Supabase confirmed. The email
// template must carry the token hash to the app (deploy notes): the app verifies it on the person's POST, never on the
// link's GET, so a mail scanner that opens the link spends nothing. Every failure is false or null; no email, token or
// key reaches an error or a log.

export type EmailVerifier = {
  /** Sends a one-time link to the email, back to `redirectTo` (an allowed redirect URL). False on any failure. */
  sendLink(email: string, redirectTo: string): Promise<boolean>;
  /** The email a link's token hash confirmed, once; null for a used, expired or unknown hash, or any failure. */
  verify(tokenHash: string): Promise<string | null>;
};

type Reply = { ok: boolean; json(): Promise<unknown> };
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Reply>;

const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;

export function supabaseEmail(opts: { url: string; publishableKey: string; fetch?: FetchLike; timeoutMs?: number }): EmailVerifier {
  const base = opts.url.replace(/\/+$/, '');
  const send = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const post = async (path: string, body: unknown): Promise<Reply | null> => {
    try {
      return await send(`${base}/auth/v1/${path}`, {
        method: 'POST',
        headers: { apikey: opts.publishableKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
    } catch {
      return null;
    }
  };
  return {
    sendLink: async (email, redirectTo) => {
      const r = await post(`otp?redirect_to=${encodeURIComponent(redirectTo)}`, { email, create_user: true });
      return r?.ok === true;
    },
    verify: async (tokenHash) => {
      if (!TOKEN_HASH.test(tokenHash)) return null;
      const r = await post('verify', { type: 'email', token_hash: tokenHash });
      if (!r?.ok) return null;
      try {
        const body = (await r.json()) as { user?: { email?: unknown; email_confirmed_at?: unknown } };
        const email = body.user?.email;
        return typeof email === 'string' && email.includes('@') && body.user?.email_confirmed_at ? email : null;
      } catch {
        return null;
      }
    },
  };
}

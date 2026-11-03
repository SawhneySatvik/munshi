// The bot-check port: every public form that stores a person's details carries a token the browser's challenge widget
// made, and the server verifies it before writing anything. The answer says whether it passed and the hostname the
// challenge was solved on, which the route checks against the site's own origins (a token solved on another site's page
// is refused). Now `recorded` (no network); Cloudflare Turnstile at deploy, behind the same port.
export type BotCheckResult = { success: boolean; hostname: string | null };
export type BotCheckRequest = { token: string; origin: string | null };

export interface BotCheckPort {
  verify(request: BotCheckRequest): Promise<BotCheckResult>;
}

// Turnstile's published test secrets: the first always passes, the second always fails. The recorded verifier answers
// as Turnstile would under them, so a test of the failing path uses the service's own test key, never the network.
export const TEST_SECRETS = { pass: '1x0000000000000000000000000000000AA', fail: '2x0000000000000000000000000000000AA' } as const;

/** No network: passes or fails as its test secret says, solved on the request's own origin's host. */
export function recordedBotCheck(secret: string = TEST_SECRETS.pass): BotCheckPort {
  if (secret !== TEST_SECRETS.pass && secret !== TEST_SECRETS.fail) throw new Error('botcheck: the recorded verifier takes a test secret');
  return {
    async verify({ token, origin }) {
      let hostname: string | null = null;
      try {
        hostname = origin ? new URL(origin).hostname : null;
      } catch {
        hostname = null;
      }
      return { success: secret === TEST_SECRETS.pass && token.length > 0, hostname };
    },
  };
}

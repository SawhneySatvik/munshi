// The identity port: it proves who a person is, and nothing else. No email, name or role leaves it; which shops a
// person belongs to, and as what, comes from Munshi's own rows on every request. Now `password` (password.ts: its own
// pool as munshi_idp, its own schema idp); Supabase Auth can replace it behind the same port.
//
// How the work splits between the port and core: a reset grant is issued and used by core (ops.reset_grant is written
// as munshi_app and munshi_public, never munshi_idp), so the port only takes a grant used a moment ago; and the invite
// page's one form is one call, so a new email and an existing one each run one scrypt.
export type Identity = { provider: 'password' | 'supabase'; subject: string };

// The request as the adapter sees it: a keyed hash of the IP (never the IP), and whether a bot check passed.
export type RequestCtx = { ipHash: Buffer; botCheck: boolean };
export type SignInInput = { email: string; password: string };

declare const opened: unique symbol;
// An invite core has opened from its link (the token's hash, unused, unexpired) and matched to the email typed, in
// core's acceptInvite. Only core makes one; the shop's name is here for the password rule.
export type InviteProof = { readonly tenantId: string; readonly inviteId: string; readonly shopName: string; readonly [opened]: true };

// A reset grant core used on the public route a moment ago: the adapter takes it once, within 5 minutes (idp.reset_use).
export type UsedReset = { tenantId: string; grantId: string; subject: string };

export interface IdentityPort {
  // Null for every failure, one shape: a wrong password, an unknown email, a locked pair, a missing bot check.
  signIn(input: SignInInput, ctx: RequestCtx): Promise<Identity | null>;
  // A new email creates the identity; an existing one is returned only with its right password. Null for every failure,
  // either way, after the same work.
  acceptInvite(invite: InviteProof, input: SignInInput, ctx: RequestCtx): Promise<Identity | null>;
  // A real shop's owner signing up: a new email makes the identity, stamped 'email' when the app holds a claim
  // Supabase Auth verified, else 'invite' (self-asserted, the schema's default); an existing one is returned only with
  // its right password. `created` says which, so a caller whose shop is then refused erases only what it made. Null for
  // every failure, after the same work. `avoid`: what a new password may not be, beside the email.
  signUpOwner(input: SignInInput & { avoid: string[] }, ctx: RequestCtx, via: 'invite' | 'email' | 'self'): Promise<{ identity: Identity; created: boolean } | null>;
  // Sets the password once, for a grant used in the last 5 minutes; false otherwise.
  setPasswordFromReset(grant: UsedReset, password: string, shopName: string): Promise<boolean>;
  erase(subject: string): Promise<void>;
  // Erases the identity only while nothing holds it: no shop's live login bound to it and not an operator's, read on the
  // committed rows under the identity's own lock (the one a login's binding takes), so a sign-up's rollback or the purge
  // of a lapsed sign-up never erases one a second submit or another shop bound meanwhile. True when it erased.
  eraseUnbound(subject: string): Promise<boolean>;
}

export * from './password.ts';
export * from './supabase-email.ts';

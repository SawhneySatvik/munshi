// The error table (BLUEPRINT §5.3): one body for every error, its message fixed per code, so a database message, a value
// or model text has nowhere to go. A new code is an additive change within v1.
export const ERRORS = {
  invalid: { status: 400, message: 'The request does not match its contract.' },
  idempotency_key_required: { status: 400, message: 'Send an Idempotency-Key header with every POST and DELETE.' },
  stale_notice: { status: 400, message: "The notice or consent version is not the site's current one. Fetch the site and try again." },
  bot_check: { status: 400, message: 'The bot check did not pass.' },
  unauthenticated: { status: 401, message: 'The signature does not match.' },
  not_found: { status: 404, message: 'Not found.' },
  slot_taken: { status: 409, message: 'That time was just taken. Pick another.' },
  idempotency_mismatch: { status: 409, message: 'This Idempotency-Key was sent before with a different request.' },
  gone: { status: 410, message: 'This route is retired.' },
  payload_too_large: { status: 413, message: 'The body is over 4 KB.' },
  unsupported_media_type: { status: 415, message: 'Send the body as JSON.' },
  rate_limited: { status: 429, message: 'Too many requests. Try again after the Retry-After header.' },
  hold_limit: { status: 429, message: 'Finish or release your other hold first.' },
  intake_paused: { status: 503, message: 'The shop is not taking requests just now.' },
  internal: { status: 500, message: 'Something went wrong on our side.' },
} as const;

export type ErrorCodeName = keyof typeof ERRORS;

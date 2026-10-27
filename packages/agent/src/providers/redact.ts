/** Env names that hold secrets (the names in .env.example). */
export const KEY_ENV_NAMES = [
  "META_MODEL_API_KEY",
  "BASETEN_API_KEY",
  "NEBIUS_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "SARVAM_API_KEY",
] as const;

const MIN_SECRET_LEN = 8;

export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of KEY_ENV_NAMES) {
    const v = env[name];
    if (v && v.length >= MIN_SECRET_LEN) out = out.split(v).join("[redacted]");
  }
  // keys that are not in env (planted, rotated) still must not leak in a Bearer header echo
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(redact(message));
    this.name = "ModelError";
  }
}

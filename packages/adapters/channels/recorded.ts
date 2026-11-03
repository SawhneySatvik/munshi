// The recorded sender: nothing leaves the machine. Each send appends one line to sent.jsonl in the outbox folder, with
// ids, the channel and the sha256 of the body only: no phone and no words, which live in the database and are erased
// there (a copy on disk would outlive the erasure).
import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Sender } from './index.ts';

// The outbox folder: MUNSHI_OUTBOX_DIR (a temp dir in tests). The config package will own the variable once it lands;
// until then this is the one place it is read, and an unset folder is an error, never a guess.
export function outboxDir(): string {
  const dir = process.env.MUNSHI_OUTBOX_DIR;
  if (!dir) throw new Error('channels: MUNSHI_OUTBOX_DIR is not set');
  return dir;
}

export function recordedSender(dir = outboxDir()): Sender {
  return async (m) => {
    await mkdir(dir, { recursive: true });
    const line = {
      delivery_id: m.deliveryId,
      tenant_id: m.tenantId,
      channel: m.channel,
      body_sha256: createHash('sha256').update(m.body, 'utf8').digest('hex'),
      at: new Date().toISOString(),
    };
    await appendFile(path.join(dir, 'sent.jsonl'), `${JSON.stringify(line)}\n`);
    // One id per delivery: ops.delivery's provider id is unique per shop.
    return { ok: true, providerMessageId: `recorded:${m.deliveryId}` };
  };
}

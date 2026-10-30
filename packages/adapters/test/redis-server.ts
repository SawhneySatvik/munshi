// A real redis-server for a test: its own process on a Unix socket in a fresh temp folder, no persistence, stopped (or
// paused and resumed) by its own PID only. The cache's gates run against this, never a double.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type RedisServer = { url: string; socket: string; pid: number; stop: () => Promise<void>; pause: () => void; resume: () => void };

const ping = (socket: string) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ path: socket });
    s.once('error', () => resolve(false));
    s.once('data', (d) => {
      s.destroy();
      resolve(d.toString().startsWith('+PONG'));
    });
    s.write('*1\r\n$4\r\nPING\r\n');
  });

export async function startRedis(): Promise<RedisServer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-redis-'));
  const socket = path.join(dir, 'redis.sock');
  const child: ChildProcess = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700', '--save', '', '--appendonly', 'no', '--dir', dir], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('test: redis-server did not start (is it on PATH?)');
  const deadline = Date.now() + 10_000;
  while (!(existsSync(socket) && (await ping(socket)))) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('test: redis-server did not answer');
    await new Promise((r) => setTimeout(r, 25));
  }
  let stopped = false;
  return {
    url: `unix://${socket}`,
    socket,
    pid,
    pause: () => process.kill(pid, 'SIGSTOP'),
    resume: () => process.kill(pid, 'SIGCONT'),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        process.kill(pid, 'SIGCONT'); // a paused server cannot act on SIGTERM
        process.kill(pid, 'SIGTERM');
        await exited;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

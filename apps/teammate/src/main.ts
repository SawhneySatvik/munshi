// Runs the relay for one shop and one Switch room, until it is refused for good or stopped.
import { loadEnvFiles, relaySettings } from '@munshi/config';
import { log } from '@munshi/core/log';
import { startRelay } from './relay.ts';

loadEnvFiles([new URL('../../../.env', import.meta.url), new URL('../../../.env.switch', import.meta.url)]);
const relay = startRelay({ ...relaySettings(), log: (event, fields) => log(`relay.${event}`, fields) });
process.on('SIGINT', relay.stop);
process.on('SIGTERM', relay.stop);
const why = await relay.stopped;
log('relay.stopped', { code: why });
process.exit(why === 'stopped' ? 0 : 1);

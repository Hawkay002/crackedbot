import type { Client } from 'discord.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { StateVerifier } from './lib/state.js';

export interface AppContext {
  cfg: Config;
  db: Db;
  client: Client;
  verifier: StateVerifier;
  startedAt: number;
  /** last successful analysis, for /health */
  lastAnalysisAt: number | null;
}

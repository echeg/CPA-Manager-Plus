/** The v8 configuration fields used by personal quota controls. */
export interface Config {
  routingStrategy?: string;
  routingSessionAffinity?: boolean;
  routingSessionAffinityTTL?: string;
  routingPreferredAccounts?: Record<string, string>;
  codexFastMode?: boolean;
  raw?: Record<string, unknown>;
}

export type RawConfigSection = 'routing/strategy' | 'codex-fast-mode';

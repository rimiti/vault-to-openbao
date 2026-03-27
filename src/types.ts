export interface Config {
  vault: {
    addr: string;
    token: string;
  };
  openbao: {
    addr: string;
    token: string;
  };
  dryRun: boolean;
  skipTlsVerify: boolean;
  skipMounts: string[];
  concurrency: number;
}

export interface MountInfo {
  path: string;
  type: string;
  description: string;
  options?: Record<string, string>;
}

export type KVVersion = 1 | 2;

export interface SecretEntry {
  mountPath: string;
  secretPath: string;
  kvVersion: KVVersion;
}

export interface MigrationStats {
  totalMounts: number;
  skippedMounts: number;
  totalSecrets: number;
  migratedSecrets: number;
  failedSecrets: number;
  errors: Array<{ path: string; error: string }>;
}

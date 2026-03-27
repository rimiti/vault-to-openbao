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
  skipPolicies: string[];
  skipAuthMethods: string[];
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

export interface AuthMount {
  path: string;
  type: string;
  description: string;
}

export interface MigrationStats {
  // KV secrets
  totalMounts: number;
  skippedMounts: number;
  totalSecrets: number;
  migratedSecrets: number;
  failedSecrets: number;
  // Policies
  totalPolicies: number;
  migratedPolicies: number;
  failedPolicies: number;
  // Auth methods
  totalAuthMethods: number;
  migratedAuthMethods: number;
  failedAuthMethods: number;
  // All errors
  errors: Array<{ path: string; error: string }>;
}

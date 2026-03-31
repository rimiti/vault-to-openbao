import { migrateAuthMethods } from "./auth";
import { createClient } from "./client";
import { migrateIdentity } from "./identity";
import { inventoryLeases } from "./leases";
import { log } from "./logger";
import { ensureMount, writeSecret } from "./openbao";
import { migratePolicies } from "./policies";
import { Config, MigrationStats, SecretEntry } from "./types";
import {
  getKVVersion,
  listMounts,
  listSecretsRecursive,
  readSecret,
} from "./vault";

async function runInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<Array<{ item: T; result?: R; error?: Error }>> {
  const results: Array<{ item: T; result?: R; error?: Error }> = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));

    settled.forEach((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        results.push({ item: batch[idx], result: outcome.value });
      } else {
        results.push({ item: batch[idx], error: outcome.reason as Error });
      }
    });
  }

  return results;
}

async function migrateSecret(
  entry: SecretEntry,
  vaultClient: ReturnType<typeof createClient>,
  openbaoClient: ReturnType<typeof createClient>,
  config: Config,
  stats: MigrationStats
): Promise<void> {
  const fullPath = `${entry.mountPath}/${entry.secretPath}`;

  try {
    const secretData = await readSecret(vaultClient, entry);

    if (!secretData || Object.keys(secretData).length === 0) {
      log.warn(`Empty secret, skipping: ${fullPath}`);
      return;
    }

    await writeSecret(openbaoClient, entry, secretData, config.dryRun);

    stats.migratedSecrets++;
    log.success(
      `${config.dryRun ? "[DRY-RUN] Would migrate" : "Migrated"}: ${fullPath}`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    stats.failedSecrets++;
    stats.errors.push({ path: fullPath, error: message });
    log.error(`Failed: ${fullPath} — ${message}`);
  }
}

export async function migrate(config: Config): Promise<MigrationStats> {
  const vaultClient = createClient(
    "vault",
    config.vault.addr,
    config.vault.token,
    config.skipTlsVerify
  );
  const openbaoClient = createClient(
    "openbao",
    config.openbao.addr,
    config.openbao.token,
    config.skipTlsVerify
  );

  const stats: MigrationStats = {
    totalPolicies: 0,
    migratedPolicies: 0,
    failedPolicies: 0,
    totalAuthMethods: 0,
    migratedAuthMethods: 0,
    failedAuthMethods: 0,
    totalEntities: 0,
    migratedEntities: 0,
    failedEntities: 0,
    totalGroups: 0,
    migratedGroups: 0,
    failedGroups: 0,
    totalLeases: 0,
    totalMounts: 0,
    skippedMounts: 0,
    totalSecrets: 0,
    migratedSecrets: 0,
    failedSecrets: 0,
    errors: [],
  };

  // Step 1 — policies
  log.section("Step 1/7 — Migrating policies");
  await migratePolicies(
    vaultClient, openbaoClient, config.skipPolicies, config.dryRun, stats
  );

  // Step 2 — auth methods
  log.section("Step 2/7 — Migrating auth methods");
  await migrateAuthMethods(
    vaultClient, openbaoClient, config.skipAuthMethods, config.dryRun, stats
  );

  // Step 3 — identity: entities + groups
  log.section("Step 3/7 — Migrating identity (entities & groups)");
  await migrateIdentity(vaultClient, openbaoClient, config.dryRun, stats);

  // Step 4 — lease inventory (informational, no writes)
  log.section("Step 4/7 — Lease inventory");
  await inventoryLeases(vaultClient, stats);

  // Step 5 — discover KV mounts
  log.section("Step 5/7 — Discovering KV mounts");
  const allMounts = await listMounts(vaultClient);
  stats.totalMounts = allMounts.length;

  const mounts = allMounts.filter((m) => !config.skipMounts.includes(m.path));
  stats.skippedMounts = allMounts.length - mounts.length;

  log.info(`Found ${allMounts.length} KV mounts, processing ${mounts.length}`);

  if (mounts.length === 0) {
    log.warn("No KV mounts to migrate.");
    return stats;
  }

  // Step 6 — enumerate secrets
  log.section("Step 6/7 — Enumerating secrets");
  const allEntries: SecretEntry[] = [];

  for (const mount of mounts) {
    const kvVersion = getKVVersion(mount);
    log.info(`  Scanning ${mount.path}/ (KV v${kvVersion})`);

    try {
      const entries = await listSecretsRecursive(vaultClient, mount, kvVersion);
      log.info(`    → ${entries.length} secret(s) found`);
      allEntries.push(...entries);
      await ensureMount(openbaoClient, mount, kvVersion);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to scan mount ${mount.path}: ${message}`);
      stats.errors.push({ path: mount.path, error: message });
    }
  }

  stats.totalSecrets = allEntries.length;
  log.info(`\nTotal secrets to migrate: ${allEntries.length}`);

  // Step 7 — migrate secrets
  log.section("Step 7/7 — Migrating secrets");

  const results = await runInBatches(
    allEntries,
    config.concurrency,
    (entry) => migrateSecret(entry, vaultClient, openbaoClient, config, stats)
  );

  const batchErrors = results.filter((r) => r.error);
  if (batchErrors.length > 0) {
    log.warn(`${batchErrors.length} unexpected batch-level errors`);
  }

  return stats;
}

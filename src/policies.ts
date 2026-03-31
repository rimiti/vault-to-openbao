import { AxiosInstance } from "axios";
import { log } from "./logger";
import { MigrationStats } from "./types";

// Built-in policies that cannot be modified or recreated
const BUILTIN_POLICIES = new Set(["root", "default"]);

export async function migratePolicies(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  skipPolicies: string[],
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  const response = await vaultClient.get("/v1/sys/policies/acl?list=true");
  const names: string[] =
    response.data.data?.keys ?? response.data.keys ?? [];

  const toMigrate = names.filter(
    (name) => !BUILTIN_POLICIES.has(name) && !skipPolicies.includes(name)
  );

  stats.totalPolicies = toMigrate.length;
  log.info(`Found ${names.length} policies, migrating ${toMigrate.length}`);

  for (const name of toMigrate) {
    try {
      const policyRes = await vaultClient.get(`/v1/sys/policies/acl/${name}`);
      const rules: string =
        policyRes.data.data?.policy ?? policyRes.data.policy ?? "";

      if (!dryRun) {
        await openbaoClient.put(`/v1/sys/policies/acl/${name}`, {
          policy: rules,
        });
      }

      stats.migratedPolicies++;
      log.success(
        `${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} policy: ${name}`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failedPolicies++;
      stats.errors.push({ path: `policy/${name}`, error: message });
      log.error(`Failed policy: ${name} — ${message}`);
    }
  }
}

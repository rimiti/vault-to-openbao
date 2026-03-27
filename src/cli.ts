#!/usr/bin/env node

import * as dotenv from "dotenv";
import { Command } from "commander";
import { log } from "./logger";
import { migrate } from "./migrate";
import { Config } from "./types";

dotenv.config();

const DEFAULT_SKIP_MOUNTS = "sys,identity,cubbyhole";
const DEFAULT_SKIP_POLICIES = "";
const DEFAULT_SKIP_AUTH_METHODS = "";

const program = new Command();

program
  .name("vault-to-openbao")
  .description("Migrate secrets, policies and auth methods from HashiCorp Vault to OpenBao")
  .version(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../package.json").version as string,
    "-V, --version",
    "Display version"
  )
  .option("--vault-addr <url>", "Source Vault URL", process.env.VAULT_ADDR)
  .option("--vault-token <token>", "Source Vault token", process.env.VAULT_TOKEN)
  .option("--openbao-addr <url>", "Destination OpenBao URL", process.env.OPENBAO_ADDR)
  .option("--openbao-token <token>", "Destination OpenBao token", process.env.OPENBAO_TOKEN)
  .option("--dry-run", "Simulate migration without writing anything", process.env.DRY_RUN === "true")
  .option("--skip-tls-verify", "Disable TLS certificate verification", process.env.SKIP_TLS_VERIFY === "true")
  .option("--skip-mounts <mounts>", "Comma-separated KV mounts to skip", process.env.SKIP_MOUNTS ?? DEFAULT_SKIP_MOUNTS)
  .option("--skip-policies <policies>", "Comma-separated policy names to skip", process.env.SKIP_POLICIES ?? DEFAULT_SKIP_POLICIES)
  .option("--skip-auth-methods <methods>", "Comma-separated auth method paths to skip", process.env.SKIP_AUTH_METHODS ?? DEFAULT_SKIP_AUTH_METHODS)
  .option("--concurrency <n>", "Number of secrets migrated in parallel", process.env.CONCURRENCY ?? "5")
  .parse(process.argv);

const opts = program.opts<{
  vaultAddr?: string;
  vaultToken?: string;
  openbaoAddr?: string;
  openbaoToken?: string;
  dryRun: boolean;
  skipTlsVerify: boolean;
  skipMounts: string;
  skipPolicies: string;
  skipAuthMethods: string;
  concurrency: string;
}>();

function requireOpt(value: string | undefined, flag: string): string {
  if (!value) {
    log.error(
      `Missing required option: ${flag} (or env var ${flag.replace("--", "").toUpperCase().replace(/-/g, "_")})`
    );
    process.exit(1);
  }
  return value;
}

function parseList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const config: Config = {
  vault: {
    addr: requireOpt(opts.vaultAddr, "--vault-addr"),
    token: requireOpt(opts.vaultToken, "--vault-token"),
  },
  openbao: {
    addr: requireOpt(opts.openbaoAddr, "--openbao-addr"),
    token: requireOpt(opts.openbaoToken, "--openbao-token"),
  },
  dryRun: opts.dryRun,
  skipTlsVerify: opts.skipTlsVerify,
  skipMounts: parseList(opts.skipMounts),
  skipPolicies: parseList(opts.skipPolicies),
  skipAuthMethods: parseList(opts.skipAuthMethods),
  concurrency: parseInt(opts.concurrency, 10),
};

async function run(): Promise<void> {
  log.section("Vault → OpenBao Migration");

  if (config.dryRun) {
    log.warn("DRY-RUN mode enabled — no writes will be performed");
  }

  log.info(`Source:            ${config.vault.addr}`);
  log.info(`Destination:       ${config.openbao.addr}`);
  log.info(`Skip mounts:       ${config.skipMounts.join(", ") || "(none)"}`);
  log.info(`Skip policies:     ${config.skipPolicies.join(", ") || "(none)"}`);
  log.info(`Skip auth methods: ${config.skipAuthMethods.join(", ") || "(none)"}`);
  log.info(`Concurrency:       ${config.concurrency}`);

  const stats = await migrate(config);

  log.section("Migration Summary");
  console.log(`  Policies migrated   : ${stats.migratedPolicies} / ${stats.totalPolicies} (${stats.failedPolicies} failed)`);
  console.log(`  Auth methods        : ${stats.migratedAuthMethods} / ${stats.totalAuthMethods} (${stats.failedAuthMethods} failed)`);
  console.log(`  KV mounts           : ${stats.totalMounts} discovered, ${stats.skippedMounts} skipped`);
  console.log(`  Secrets migrated    : ${stats.migratedSecrets} / ${stats.totalSecrets} (${stats.failedSecrets} failed)`);

  if (stats.errors.length > 0) {
    log.section("Errors");
    stats.errors.forEach(({ path, error }) => {
      log.error(`  ${path}: ${error}`);
    });
    process.exit(1);
  }

  log.success("Migration completed successfully.");
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log.error(`Fatal: ${message}`);
  process.exit(1);
});

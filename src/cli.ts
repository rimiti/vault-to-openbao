#!/usr/bin/env node

import * as dotenv from "dotenv";
import { Command } from "commander";
import { log } from "./logger";
import { migrate } from "./migrate";
import { Config } from "./types";

dotenv.config();

const DEFAULT_SKIP_MOUNTS = "sys,identity,cubbyhole";

const program = new Command();

program
  .name("vault-to-openbao")
  .description("Migrate secrets from HashiCorp Vault to OpenBao")
  .version(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../package.json").version as string,
    "-V, --version",
    "Display version"
  )
  .option(
    "--vault-addr <url>",
    "Source Vault URL",
    process.env.VAULT_ADDR
  )
  .option(
    "--vault-token <token>",
    "Source Vault token",
    process.env.VAULT_TOKEN
  )
  .option(
    "--openbao-addr <url>",
    "Destination OpenBao URL",
    process.env.OPENBAO_ADDR
  )
  .option(
    "--openbao-token <token>",
    "Destination OpenBao token",
    process.env.OPENBAO_TOKEN
  )
  .option(
    "--dry-run",
    "Simulate migration without writing anything",
    process.env.DRY_RUN === "true"
  )
  .option(
    "--skip-tls-verify",
    "Disable TLS certificate verification",
    process.env.SKIP_TLS_VERIFY === "true"
  )
  .option(
    "--skip-mounts <mounts>",
    "Comma-separated list of mounts to skip",
    process.env.SKIP_MOUNTS ?? DEFAULT_SKIP_MOUNTS
  )
  .option(
    "--concurrency <n>",
    "Number of secrets migrated in parallel",
    process.env.CONCURRENCY ?? "5"
  )
  .parse(process.argv);

const opts = program.opts<{
  vaultAddr?: string;
  vaultToken?: string;
  openbaoAddr?: string;
  openbaoToken?: string;
  dryRun: boolean;
  skipTlsVerify: boolean;
  skipMounts: string;
  concurrency: string;
}>();

function requireOpt(value: string | undefined, flag: string): string {
  if (!value) {
    log.error(`Missing required option: ${flag} (or env var ${flag.replace("--", "").toUpperCase().replace(/-/g, "_")})`);
    process.exit(1);
  }
  return value;
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
  skipMounts: opts.skipMounts
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  concurrency: parseInt(opts.concurrency, 10),
};

async function run(): Promise<void> {
  log.section("Vault → OpenBao Migration");

  if (config.dryRun) {
    log.warn("DRY-RUN mode enabled — no writes will be performed");
  }

  log.info(`Source:      ${config.vault.addr}`);
  log.info(`Destination: ${config.openbao.addr}`);
  log.info(`Skip mounts: ${config.skipMounts.join(", ")}`);
  log.info(`Concurrency: ${config.concurrency}`);

  const stats = await migrate(config);

  log.section("Migration Summary");
  console.log(`  Mounts discovered : ${stats.totalMounts}`);
  console.log(`  Mounts skipped    : ${stats.skippedMounts}`);
  console.log(`  Secrets found     : ${stats.totalSecrets}`);
  console.log(`  Secrets migrated  : ${stats.migratedSecrets}`);
  console.log(`  Secrets failed    : ${stats.failedSecrets}`);

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

import { AxiosInstance } from "axios";
import { log } from "./logger";
import { AuthMount, MigrationStats } from "./types";

// Built-in auth methods that cannot be disabled
const BUILTIN_AUTH = new Set(["token"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeList(
  client: AxiosInstance,
  path: string
): Promise<string[]> {
  try {
    const res = await client.request({ method: "LIST", url: path });
    return res.data.data?.keys ?? [];
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      (err as { response: { status: number } }).response?.status === 404
    ) {
      return [];
    }
    throw err;
  }
}

async function safeGet(
  client: AxiosInstance,
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await client.get(path);
    return res.data.data ?? res.data;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      (err as { response: { status: number } }).response?.status === 404
    ) {
      return null;
    }
    throw err;
  }
}

/** Migrate a list of named resources (roles, users, groups…) */
async function migrateNamedResources(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  listPath: string,
  readPath: (name: string) => string,
  writePath: (name: string) => string,
  label: string,
  dryRun: boolean,
  errors: Array<{ path: string; error: string }>
): Promise<void> {
  const names = await safeList(vaultClient, listPath);
  if (names.length === 0) return;

  log.info(`    ${label}: ${names.length} found`);

  for (const name of names) {
    const data = await safeGet(vaultClient, readPath(name));
    if (!data) continue;

    if (!dryRun) {
      await openbaoClient.post(writePath(name), data);
    }
    log.success(
      `    ${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} ${label}: ${name}`
    );
  }
}

/** Migrate config block (single object) */
async function migrateConfig(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  configPath: string,
  dryRun: boolean
): Promise<void> {
  const data = await safeGet(vaultClient, configPath);
  if (!data || Object.keys(data).length === 0) return;

  if (!dryRun) {
    await openbaoClient.post(configPath, data);
  }
  log.info(
    `    ${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} config`
  );
}

// ---------------------------------------------------------------------------
// Per-type handlers
// ---------------------------------------------------------------------------

type AuthHandler = (
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  mountPath: string,
  dryRun: boolean,
  errors: Array<{ path: string; error: string }>
) => Promise<void>;

const handlers: Record<string, AuthHandler> = {
  async approle(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/role`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      "role", dryRun, errors
    );
  },

  async kubernetes(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    await migrateConfig(vaultClient, openbaoClient, `/v1/auth/${mountPath}/config`, dryRun);
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/role`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      "role", dryRun, errors
    );
  },

  async userpass(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    // Passwords are hashed and unreadable — only metadata (token_policies, etc.) is migrated
    log.warn(`    userpass passwords cannot be extracted — users will need to reset their passwords`);
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/users`,
      (n) => `/v1/auth/${mountPath}/users/${n}`,
      (n) => `/v1/auth/${mountPath}/users/${n}`,
      "user", dryRun, errors
    );
  },

  async jwt(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    await migrateConfig(vaultClient, openbaoClient, `/v1/auth/${mountPath}/config`, dryRun);
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/role`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      (n) => `/v1/auth/${mountPath}/role/${n}`,
      "role", dryRun, errors
    );
  },

  async ldap(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    await migrateConfig(vaultClient, openbaoClient, `/v1/auth/${mountPath}/config`, dryRun);
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/groups`,
      (n) => `/v1/auth/${mountPath}/groups/${n}`,
      (n) => `/v1/auth/${mountPath}/groups/${n}`,
      "group", dryRun, errors
    );
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/users`,
      (n) => `/v1/auth/${mountPath}/users/${n}`,
      (n) => `/v1/auth/${mountPath}/users/${n}`,
      "user", dryRun, errors
    );
  },

  async github(vaultClient, openbaoClient, mountPath, dryRun, errors) {
    await migrateConfig(vaultClient, openbaoClient, `/v1/auth/${mountPath}/config`, dryRun);
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/map/teams`,
      (n) => `/v1/auth/${mountPath}/map/teams/${n}`,
      (n) => `/v1/auth/${mountPath}/map/teams/${n}`,
      "team", dryRun, errors
    );
    await migrateNamedResources(
      vaultClient, openbaoClient,
      `/v1/auth/${mountPath}/map/users`,
      (n) => `/v1/auth/${mountPath}/map/users/${n}`,
      (n) => `/v1/auth/${mountPath}/map/users/${n}`,
      "user", dryRun, errors
    );
  },
};

// oidc reuses the jwt handler
handlers.oidc = handlers.jwt;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function listAuthMounts(
  client: AxiosInstance
): Promise<AuthMount[]> {
  const response = await client.get("/v1/sys/auth");
  const data = response.data.data ?? response.data;

  return Object.entries(data).map(([path, info]) => {
    const mount = info as { type: string; description: string };
    return {
      path: path.replace(/\/$/, ""),
      type: mount.type,
      description: mount.description ?? "",
    };
  });
}

export async function migrateAuthMethods(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  skipAuthMethods: string[],
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  const allMounts = await listAuthMounts(vaultClient);

  const toMigrate = allMounts.filter(
    (m) => !BUILTIN_AUTH.has(m.type) && !skipAuthMethods.includes(m.path)
  );

  stats.totalAuthMethods = toMigrate.length;
  log.info(
    `Found ${allMounts.length} auth methods, migrating ${toMigrate.length}`
  );

  for (const mount of toMigrate) {
    log.info(`  Auth [${mount.type}] ${mount.path}/`);

    try {
      // Enable the auth method in OpenBao if not already present
      const existing = await listAuthMounts(openbaoClient);
      if (!existing.some((m) => m.path === mount.path)) {
        if (!dryRun) {
          await openbaoClient.post(`/v1/sys/auth/${mount.path}`, {
            type: mount.type,
            description: mount.description,
          });
        }
        log.info(
          `    ${dryRun ? "[DRY-RUN] Would enable" : "Enabled"} auth method`
        );
      }

      // Run the per-type handler
      const handler = handlers[mount.type];
      if (handler) {
        await handler(
          vaultClient,
          openbaoClient,
          mount.path,
          dryRun,
          stats.errors
        );
      } else {
        log.warn(
          `    No handler for auth type "${mount.type}" — mount enabled, config skipped`
        );
      }

      stats.migratedAuthMethods++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failedAuthMethods++;
      stats.errors.push({ path: `auth/${mount.path}`, error: message });
      log.error(`Failed auth method: ${mount.path} — ${message}`);
    }
  }
}

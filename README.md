# @rimiti/vault-to-openbao

Migrate secrets, policies and auth methods from HashiCorp Vault to OpenBao, designed to run against a Kubernetes cluster.

## Prerequisites

- Node.js >= 18
- Network access to both instances (Vault and OpenBao)
- Root token, or a token with read/list rights on Vault and write rights on OpenBao

## Installation

### Global (CLI usage)

```bash
npm install -g @rimiti/vault-to-openbao
```

### Local (programmatic usage)

```bash
yarn add @rimiti/vault-to-openbao
```

## CLI

### Configuration

All options can be passed as CLI flags or environment variables. CLI flags take precedence.

| Flag                  | Env var              | Description                                        | Default                  |
| --------------------- | -------------------- | -------------------------------------------------- | ------------------------ |
| `--vault-addr`        | `VAULT_ADDR`         | URL of the source Vault instance                   | —                        |
| `--vault-token`       | `VAULT_TOKEN`        | Vault authentication token                         | —                        |
| `--openbao-addr`      | `OPENBAO_ADDR`       | URL of the destination OpenBao instance            | —                        |
| `--openbao-token`     | `OPENBAO_TOKEN`      | OpenBao authentication token                       | —                        |
| `--dry-run`           | `DRY_RUN=true`       | Simulate migration without writing                 | `false`                  |
| `--skip-tls-verify`   | `SKIP_TLS_VERIFY=true` | Disable TLS certificate verification             | `false`                  |
| `--skip-mounts`       | `SKIP_MOUNTS`        | Comma-separated KV mounts to skip                  | `sys,identity,cubbyhole` |
| `--skip-policies`     | `SKIP_POLICIES`      | Comma-separated policy names to skip               | —                        |
| `--skip-auth-methods` | `SKIP_AUTH_METHODS`  | Comma-separated auth method paths to skip          | —                        |
| `--concurrency`       | `CONCURRENCY`        | Number of secrets migrated in parallel             | `5`                      |
| `-V, --version`       |                      | Display version                                    |                          |
| `-h, --help`          |                      | Display help                                       |                          |

### Usage

Dry-run first (recommended):

```bash
vault-to-openbao \
  --vault-addr https://vault.example.com \
  --vault-token hvs.xxxx \
  --openbao-addr https://openbao.example.com \
  --openbao-token s.xxxx \
  --dry-run
```

Real migration:

```bash
vault-to-openbao \
  --vault-addr https://vault.example.com \
  --vault-token hvs.xxxx \
  --openbao-addr https://openbao.example.com \
  --openbao-token s.xxxx
```

Using a `.env` file instead of flags:

```bash
cp .env.example .env
# edit .env, then:
vault-to-openbao
```

## Programmatic API

```ts
import { migrate } from "@rimiti/vault-to-openbao";

const stats = await migrate({
  vault: {
    addr: "https://vault.example.com",
    token: "hvs.xxxx",
  },
  openbao: {
    addr: "https://openbao.example.com",
    token: "s.xxxx",
  },
  dryRun: false,
  skipTlsVerify: false,
  skipMounts: ["sys", "identity", "cubbyhole"],
  skipPolicies: [],
  skipAuthMethods: [],
  concurrency: 5,
});

console.log(`Policies  : ${stats.migratedPolicies} / ${stats.totalPolicies}`);
console.log(`Auth      : ${stats.migratedAuthMethods} / ${stats.totalAuthMethods}`);
console.log(`Secrets   : ${stats.migratedSecrets} / ${stats.totalSecrets}`);
```

### `migrate(config)` return value

```ts
interface MigrationStats {
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
```

## How it works

The migration runs in five steps:

```
Step 1/5 — Migrating policies
  → Lists all ACL policies via /v1/sys/policies/acl
  → Skips built-in policies (root, default)
  → Writes each policy to OpenBao

Step 2/5 — Migrating auth methods
  → Lists all auth mounts via /v1/sys/auth
  → Skips built-in auth (token)
  → Enables each method in OpenBao, then migrates its config and roles/users

Step 3/5 — Discovering KV mounts
  → Queries /v1/sys/mounts on Vault
  → Filters mounts of type KV (v1 and v2)
  → Excludes system mounts (sys, identity, cubbyhole)

Step 4/5 — Enumerating secrets
  → Recursively walks each mount using the LIST operation
  → Creates any missing mounts in OpenBao

Step 5/5 — Migrating secrets
  → Reads each secret from Vault
  → Writes it to OpenBao (in parallel batches)
```

### Supported auth method types

| Type         | Config | Roles | Users / Groups | Notes                                       |
| ------------ | :----: | :---: | :------------: | ------------------------------------------- |
| `approle`    | —      | ✓     | —              | Secret IDs cannot be extracted              |
| `kubernetes` | ✓      | ✓     | —              |                                             |
| `userpass`   | —      | —     | ✓              | Passwords are hashed — users must reset     |
| `jwt`        | ✓      | ✓     | —              |                                             |
| `oidc`       | ✓      | ✓     | —              |                                             |
| `ldap`       | ✓      | —     | ✓ + groups     |                                             |
| `github`     | ✓      | —     | ✓ + teams      |                                             |
| others       | —      | —     | —              | Mount is enabled, content is skipped (warn) |

### KV version handling

| Version | Vault read                    | OpenBao write                  |
| ------- | ----------------------------- | ------------------------------ |
| KV v1   | `GET /v1/<mount>/<path>`      | `POST /v1/<mount>/<path>`      |
| KV v2   | `GET /v1/<mount>/data/<path>` | `POST /v1/<mount>/data/<path>` |

The version is detected automatically from the mount options (`options.version`).

## Output

```
============================================================
Vault → OpenBao Migration
============================================================
2026-03-27T10:00:00.000Z INFO  Source:            https://vault.example.com
2026-03-27T10:00:00.000Z INFO  Destination:       https://openbao.example.com
...
2026-03-27T10:00:00.000Z OK    Migrated policy: app-readonly
2026-03-27T10:00:00.000Z OK    Migrated policy: app-readwrite
2026-03-27T10:00:01.000Z OK    Migrated auth [kubernetes] kubernetes/
2026-03-27T10:00:01.000Z OK    Migrated: secret/app/database
2026-03-27T10:00:01.000Z OK    Migrated: secret/app/api-keys
...
============================================================
Migration Summary
============================================================
  Policies migrated   : 2 / 2 (0 failed)
  Auth methods        : 1 / 1 (0 failed)
  KV mounts           : 3 discovered, 0 skipped
  Secrets migrated    : 42 / 42 (0 failed)
```

The CLI exits with code `1` if at least one item failed to migrate.

## Required permissions

### Vault (source) — minimal policy

```hcl
# KV secrets
path "sys/mounts" {
  capabilities = ["read"]
}
path "<mount>/metadata/*" {
  capabilities = ["list"]
}
path "<mount>/data/*" {
  capabilities = ["read"]
}
# KV v1
path "<mount>/*" {
  capabilities = ["read", "list"]
}

# Policies
path "sys/policies/acl" {
  capabilities = ["list"]
}
path "sys/policies/acl/*" {
  capabilities = ["read"]
}

# Auth methods
path "sys/auth" {
  capabilities = ["read"]
}
path "auth/*" {
  capabilities = ["read", "list"]
}
```

### OpenBao (destination) — minimal policy

```hcl
# KV secrets
path "sys/mounts" {
  capabilities = ["read"]
}
path "sys/mounts/<mount>" {
  capabilities = ["create", "update"]
}
path "<mount>/data/*" {
  capabilities = ["create", "update"]
}
# KV v1
path "<mount>/*" {
  capabilities = ["create", "update"]
}

# Policies
path "sys/policies/acl/*" {
  capabilities = ["create", "update"]
}

# Auth methods
path "sys/auth" {
  capabilities = ["read"]
}
path "sys/auth/*" {
  capabilities = ["create", "update"]
}
path "auth/*" {
  capabilities = ["create", "update"]
}
```

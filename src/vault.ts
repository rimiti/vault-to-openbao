import { AxiosInstance } from "axios";
import { KVVersion, MountInfo, SecretEntry } from "./types";

export async function listMounts(client: AxiosInstance): Promise<MountInfo[]> {
  const response = await client.get("/v1/sys/mounts");
  const data = response.data.data ?? response.data;

  return Object.entries(data)
    .filter(([, info]) => (info as { type: string }).type === "kv")
    .map(([path, info]) => {
      const mount = info as {
        type: string;
        description: string;
        options?: { version?: string };
      };
      return {
        path: path.replace(/\/$/, ""),
        type: mount.type,
        description: mount.description ?? "",
        options: mount.options as Record<string, string> | undefined,
      };
    });
}

export function getKVVersion(mount: MountInfo): KVVersion {
  return mount.options?.version === "2" ? 2 : 1;
}

export async function listSecretsRecursive(
  client: AxiosInstance,
  mount: MountInfo,
  kvVersion: KVVersion,
  prefix = ""
): Promise<SecretEntry[]> {
  const listPath =
    kvVersion === 2
      ? `/v1/${mount.path}/metadata/${prefix}`
      : `/v1/${mount.path}/${prefix}`;

  let keys: string[];
  try {
    const separator = listPath.includes("?") ? "&" : "?";
    const response = await client.get(`${listPath}${separator}list=true`);
    keys = response.data.data?.keys ?? [];
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

  const entries: SecretEntry[] = [];

  for (const key of keys) {
    const fullPath = prefix ? `${prefix}${key}` : key;
    if (key.endsWith("/")) {
      const children = await listSecretsRecursive(
        client,
        mount,
        kvVersion,
        fullPath
      );
      entries.push(...children);
    } else {
      entries.push({
        mountPath: mount.path,
        secretPath: fullPath,
        kvVersion,
      });
    }
  }

  return entries;
}

export async function readSecret(
  client: AxiosInstance,
  entry: SecretEntry
): Promise<Record<string, unknown>> {
  const readPath =
    entry.kvVersion === 2
      ? `/v1/${entry.mountPath}/data/${entry.secretPath}`
      : `/v1/${entry.mountPath}/${entry.secretPath}`;

  const response = await client.get(readPath);
  const data = response.data.data;

  // KV v2 wraps values under data.data
  return entry.kvVersion === 2 ? data.data : data;
}

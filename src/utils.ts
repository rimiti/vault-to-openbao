import { AxiosInstance } from "axios";

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    (err as { response: { status: number } }).response?.status === 404
  );
}

export async function safeList(
  client: AxiosInstance,
  path: string
): Promise<string[]> {
  try {
    const separator = path.includes("?") ? "&" : "?";
    const res = await client.get(`${path}${separator}list=true`);
    return res.data.data?.keys ?? [];
  } catch (err: unknown) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export async function safeGet(
  client: AxiosInstance,
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await client.get(path);
    return res.data.data ?? res.data;
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import * as https from "https";
import { log } from "./logger";

export function createClient(
  name: string,
  baseURL: string,
  token: string,
  skipTlsVerify: boolean
): AxiosInstance {
  const httpsAgent = new https.Agent({ rejectUnauthorized: !skipTlsVerify });

  const client = axios.create({
    baseURL,
    httpsAgent,
    headers: {
      "X-Vault-Token": token,
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });

  // Request logging
  client.interceptors.request.use((config) => {
    log.debug(`[${name}] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}${config.data ? ` body=${JSON.stringify(config.data).substring(0, 200)}` : ""}`);
    return config;
  });

  // Response logging
  client.interceptors.response.use(
    (response) => {
      log.debug(`[${name}] ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
      return response;
    },
    (error) => {
      if (error.response) {
        const { status, data } = error.response;
        const method = error.config?.method?.toUpperCase() ?? "?";
        const url = error.config?.url ?? "?";
        const errorBody = typeof data === "object" ? JSON.stringify(data) : String(data);
        log.error(`[${name}] ${status} ${method} ${url} — ${errorBody}`);
      } else if (error.request) {
        log.error(`[${name}] No response — ${error.message}`);
      } else {
        log.error(`[${name}] Request setup error — ${error.message}`);
      }
      return Promise.reject(error);
    }
  );

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) =>
      axiosRetry.isNetworkError(error) ||
      (error.response?.status !== undefined && error.response.status >= 500),
  });

  return client;
}

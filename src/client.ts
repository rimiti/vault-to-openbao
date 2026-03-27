import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import * as https from "https";

export function createClient(
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

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) =>
      axiosRetry.isNetworkError(error) ||
      (error.response?.status !== undefined && error.response.status >= 500),
  });

  return client;
}

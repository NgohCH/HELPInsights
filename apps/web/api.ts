export type Workspace = {
  id: string;
  name: string;
  defaultRetentionPolicyId?: string;
};

export async function api<T>(
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: object;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch("/api/v1" + path, {
    method: options.method,
    headers: {
      ...options.headers,
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "omit",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Request failed");
  return { data: data as T, etag: response.headers.get("etag") };
}

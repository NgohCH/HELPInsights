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
    signal?: AbortSignal;
  } = {},
) {
  const response = await fetch("/api/v1" + path, {
    method: options.method,
    signal: options.signal,
    headers: {
      ...options.headers,
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: options.token === "" ? "same-origin" : "omit",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Request failed");
  return { data: data as T, etag: response.headers.get("etag") };
}

export async function signOutUniversity(returnPath: "/" | "/admin") {
  const response = await fetch("/auth/university/logout", { method: "POST" });
  if (!response.ok) throw new Error("Sign-out failed");
  window.location.assign(returnPath);
}

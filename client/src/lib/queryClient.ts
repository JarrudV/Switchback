import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getFirebaseIdToken } from "@/lib/firebase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

async function buildAuthHeaders(headers?: HeadersInit): Promise<HeadersInit> {
  const token = await getFirebaseIdToken();
  const authHeader: Record<string, string> = {};
  if (token) {
    authHeader.Authorization = `Bearer ${token}`;
  }

  if (!headers) {
    return authHeader;
  }

  if (headers instanceof Headers) {
    const merged = new Headers(headers);
    if (token) {
      merged.set("Authorization", `Bearer ${token}`);
    }
    return merged;
  }

  if (Array.isArray(headers)) {
    const merged = [...headers];
    if (token) {
      merged.push(["Authorization", `Bearer ${token}`]);
    }
    return merged;
  }

  return {
    ...headers,
    ...authHeader,
  };
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers = await buildAuthHeaders(
    data ? { "Content-Type": "application/json" } : undefined,
  );
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers = await buildAuthHeaders();
    const res = await fetch(queryKey.join("/") as string, {
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

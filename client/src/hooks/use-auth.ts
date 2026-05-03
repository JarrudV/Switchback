import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import type { User } from "@shared/models/auth";
import { clearOfflineSyncStorage } from "@/hooks/use-offline-sync";
import { firebaseAuth, firebaseConfigured } from "@/lib/firebase";

async function fetchUser(): Promise<User | null> {
  const headers: Record<string, string> = {};

  if (firebaseConfigured && firebaseAuth?.currentUser) {
    try {
      const token = await firebaseAuth.currentUser.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      // ignore token errors; server bypass will handle it
    }
  }

  const response = await fetch("/api/auth/user", { headers });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
  return response.json();
}

async function doLogout(): Promise<void> {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_USER_CACHE" });
  }
  clearOfflineSyncStorage();
  if (firebaseConfigured && firebaseAuth) {
    await signOut(firebaseAuth);
  }
}

export function useAuth() {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(
    firebaseConfigured ? (firebaseAuth?.currentUser ?? null) : null,
  );
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!firebaseConfigured || !firebaseAuth) {
      setAuthReady(true);
      return;
    }

    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        queryClient.setQueryData(["/api/auth/user"], null);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    });

    unsubRef.current = unsub;
    return () => unsub();
  }, [queryClient]);

  const queryEnabled = firebaseConfigured ? authReady && !!firebaseUser : authReady;

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
    enabled: queryEnabled,
  });

  const logoutMutation = useMutation({
    mutationFn: doLogout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.clear();
    },
  });

  const isAuthenticated = firebaseConfigured ? !!firebaseUser && !!user : !!user;

  return {
    user: isAuthenticated ? (user ?? null) : null,
    isLoading: !authReady || (queryEnabled ? isLoading : false),
    isAuthenticated,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}

import Storage from "expo-sqlite/kv-store";

/**
 * Persisted client state (Expo Go compatible replacement for MMKV): expo-sqlite's key-value store.
 * Synchronous reads let stores hydrate before the first render.
 */
export const kv = {
  getJSON<T>(key: string, fallback: T): T {
    try {
      const raw = Storage.getItemSync(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  setJSON(key: string, value: unknown): void {
    try {
      Storage.setItemSync(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: client state is best effort.
    }
  },
  remove(key: string): void {
    try {
      Storage.removeItemSync(key);
    } catch {
      // ignore
    }
  },
  /** Async adapter for supabase-js session persistence. */
  authStorage: {
    getItem: (key: string) => Storage.getItem(key),
    setItem: (key: string, value: string) => Storage.setItem(key, value),
    removeItem: (key: string) => Storage.removeItem(key),
  },
};

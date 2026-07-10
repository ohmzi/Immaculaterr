import { useEffect, useState } from 'react';

/**
 * useState that survives reloads via localStorage. Values must be
 * JSON-serializable; storage failures fall back to in-memory state.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // fall through to the initial value
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full/blocked — state still works for this session
    }
  }, [key, value]);

  return [value, setValue];
}

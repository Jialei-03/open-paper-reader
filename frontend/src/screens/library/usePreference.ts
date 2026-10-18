import { useCallback, useState } from "react";

/**
 * A choice kept on this device (`localStorage`): one of `allowed`, `fallback`
 * when nothing valid is stored. Storage can be missing or full; the choice then
 * lasts until the page is left.
 */
export function usePreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.find((option) => option === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* Storage may be unavailable. */
      }
    },
    [key],
  );
  return [value, set];
}

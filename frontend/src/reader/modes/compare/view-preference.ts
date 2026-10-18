import { useCallback, useState } from "react";

/** The translated PDF alone, or beside the original. */
export type TranslatedView = "only" | "compare";

const key = (owner: string) => `paper-translated-view:${owner}`;

export function readTranslatedView(owner: string): TranslatedView | null {
  try {
    const value = localStorage.getItem(key(owner));
    return value === "only" || value === "compare" ? value : null;
  } catch {
    return null;
  }
}

function writeTranslatedView(owner: string, view: TranslatedView): void {
  try {
    localStorage.setItem(key(owner), view);
  } catch {
    /* Private mode: the choice lasts until the page is left. */
  }
}

/**
 * How the translated PDF is read: the person's last choice (kept in the
 * browser, for each user), else beside the original where the card is wide
 * enough for two pages (`wide`) and alone where it is not.
 */
export function useTranslatedView(
  owner: string,
  wide: boolean,
): [TranslatedView, (view: TranslatedView) => void] {
  const [chosen, setChosen] = useState<TranslatedView | null>(() =>
    readTranslatedView(owner),
  );
  const choose = useCallback(
    (view: TranslatedView) => {
      setChosen(view);
      writeTranslatedView(owner, view);
    },
    [owner],
  );
  return [chosen ?? (wide ? "compare" : "only"), choose];
}

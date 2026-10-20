import { useEffect, useState } from "react";
import { api } from "../api";

let asked: Promise<boolean> | null = null;

/** Whether this is the local edition (`mode: "local"`), asked once per page. */
function askLocal() {
  asked ??= api<{ mode?: string }>("/health").then(
    (health) => health.mode === "local",
    (error: unknown) => {
      asked = null;
      throw error;
    },
  );
  return asked;
}

/**
 * True on this machine's own server, false on the hosted site, null until
 * the server has said. Research runs only on the local edition.
 */
export function useLocal(): boolean | null {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    askLocal().then(
      (value) => live && setLocal(value),
      () => {
        /* Unknown stays unknown: nothing is offered or taken away on a guess. */
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return local;
}

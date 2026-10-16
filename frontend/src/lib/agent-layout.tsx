import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

type Mode = "docked" | "floating";
type Layout = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  mode: Mode;
  setMode: (mode: Mode) => void;
  introductionHost: HTMLDivElement | null;
  setIntroductionHost: Dispatch<SetStateAction<HTMLDivElement | null>>;
  host: HTMLDivElement | null;
  setHost: Dispatch<SetStateAction<HTMLDivElement | null>>;
};
const AgentLayout = createContext<Layout | null>(null);
export function AgentLayoutProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [introductionHost, setIntroductionHost] =
    useState<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [mode, changeMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem("agent-display:" + userId) === "floating"
        ? "floating"
        : "docked";
    } catch {
      return "docked";
    }
  });
  const setMode = (value: Mode) => {
    changeMode(value);
    try {
      localStorage.setItem("agent-display:" + userId, value);
    } catch {
      /* Session preference still works. */
    }
  };
  return (
    <AgentLayout.Provider
      value={{
        open,
        setOpen,
        mode,
        setMode,
        host,
        setHost,
        introductionHost,
        setIntroductionHost,
      }}
    >
      {children}
    </AgentLayout.Provider>
  );
}
export function useAgentLayout() {
  const value = useContext(AgentLayout);
  if (!value) throw new Error("Agent layout provider missing");
  return value;
}

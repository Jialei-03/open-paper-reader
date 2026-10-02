import { createContext, useContext } from "react";

export const ReaderPanels = createContext<{
  annotationHost: HTMLDivElement | null;
  fileId: string;
} | null>(null);
export const useReaderPanels = () => useContext(ReaderPanels);

import type { ComponentProps } from "react";
import { LibraryView } from "./LibraryView";

/** Home is the recent paper list, sharing all real library operations. */
export function Dashboard(props: ComponentProps<typeof LibraryView>) {
  return <LibraryView {...props} recent />;
}

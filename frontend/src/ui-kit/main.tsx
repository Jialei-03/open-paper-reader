import { createRoot } from "react-dom/client";
import "../ui/reset.css";
import "../ui";
import { KitApp } from "./KitApp";

createRoot(document.getElementById("root")!).render(<KitApp />);

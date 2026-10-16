import { Alert, AlertDescription } from "@/components/ui/alert";
import { createContext, useContext, useRef, type ReactNode } from "react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "./ui/dialog";
export const FeedbackContext = createContext("");
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const error = useContext(FeedbackContext),
    opener = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={
          wide ? "research-dialog sm:max-w-2xl" : "research-dialog sm:max-w-lg"
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            编辑资料，完成后保存。
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body overflow-y-auto min-h-0">
          {error && (
            <Alert variant="destructive" className="my-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

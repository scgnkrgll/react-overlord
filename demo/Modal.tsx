import type { ReactNode } from "react";
import type { OverlayState } from "../src";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The failure from a rejected `onSubmit`, shown while the overlay stays open for a retry. */
export function SubmitError({ state }: { state: OverlayState }) {
  if (state.phase !== "failed") return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.error instanceof Error ? state.error.message : String(state.error)}</AlertDescription>
    </Alert>
  );
}

/**
 * A shadcn Dialog, built on Base UI, that the overlay manager controls. It closes when the overlay enters `closing`
 * and calls `onExited` after Base UI finishes the exit animation. Escape, outside clicks and the × button call
 * `onDismiss`, unless `canDismiss` is false.
 */
export function Modal({
  title,
  state,
  canDismiss = true,
  onDismiss,
  onExited,
  children,
  footer,
}: {
  title: string;
  state: OverlayState;
  canDismiss?: boolean;
  onDismiss: () => void;
  onExited: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog
      open={state.phase !== "closing"}
      onOpenChange={(open) => !open && canDismiss && onDismiss()}
      onOpenChangeComplete={(open) => !open && onExited()}
    >
      <DialogContent showCloseButton={canDismiss}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <SubmitError state={state} />
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

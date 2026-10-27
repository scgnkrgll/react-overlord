import { XIcon } from "lucide-react";
import { useOverlay } from "../src";
import { useStackItem } from "../src/stack.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { overlays } from "./overlays";
import { useCountdown } from "./useCountdown";

/** How many toasts peek out of the collapsed pile. */
const VISIBLE_IN_PILE = 3;

const toneClass = { info: "border-l-primary", success: "border-l-success", error: "border-l-destructive" };

function Toast({
  message,
  tone = "info",
  duration = 4000,
}: {
  message: string;
  tone?: "info" | "success" | "error";
  duration?: number;
}) {
  const { id, state, dismiss, exited } = useOverlay(ToastOverlay);
  const stack = useStackItem(id);
  const closing = state.phase === "closing";

  useCountdown(duration, stack.paused, dismiss);

  return (
    <li
      className="toast"
      data-phase={state.phase}
      data-front={stack.index === 0}
      data-hidden={stack.index >= VISIBLE_IN_PILE}
      data-expanded={stack.expanded}
      style={{ "--index": stack.index, "--offset": `${stack.offset}px` } as React.CSSProperties}
      onTransitionEnd={(e) => closing && e.target === e.currentTarget && e.propertyName === "opacity" && exited()}
    >
      {/* Measured element: its natural height, even while the pile clamps the outer <li>. */}
      <div
        ref={stack.ref}
        className={cn(
          "toast-body flex items-center justify-between gap-2 rounded-lg border border-l-4 bg-popover py-2.5 pr-2 pl-3.5 text-sm text-popover-foreground shadow-lg",
          toneClass[tone],
        )}
      >
        <span>{message}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={dismiss}>
          <XIcon />
        </Button>
      </div>
    </li>
  );
}

// If the exit transition doesn't run, for example in a background tab, the toast is removed after 500ms.
export const ToastOverlay = overlays.createOverlay("toast", Toast, { exitTransition: true, exitTimeout: 500 });

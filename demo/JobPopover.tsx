import { useState } from "react";
import { useOverlay } from "../src";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { SubmitError } from "./Modal";
import { overlays } from "./overlays";

interface JobPopoverProps {
  /** The element the popover points at, e.g. the clicked table cell. */
  anchor: Element;
  job: string;
}

/**
 * A shadcn Popover, built on Base UI, anchored to the element that opened it. It is in the `menu` layer with the
 * context menu, so opening one dismisses the other.
 */
function JobPopover({ anchor, job }: JobPopoverProps) {
  const { state, submit, dismiss, exited } = useOverlay(JobPopoverOverlay);
  const [draft, setDraft] = useState(job);
  const pending = state.phase === "pending";

  return (
    <Popover
      open={state.phase !== "closing"}
      onOpenChange={(open) => !open && dismiss()}
      onOpenChangeComplete={(open) => !open && exited()}
    >
      <PopoverContent anchor={anchor}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft.trim());
          }}
        >
          <PopoverTitle>Job title</PopoverTitle>
          <Input aria-label="Job title" value={draft} disabled={pending} onChange={(e) => setDraft(e.target.value)} />
          <SubmitError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={dismiss} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Submits the edited job title. */
export const JobPopoverOverlay = overlays.createOverlay<JobPopoverProps, string>("menu", JobPopover, {
  exitTransition: true,
});

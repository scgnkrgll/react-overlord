import { createContext } from "react";
import type { Control } from "./store.ts";

export interface InstanceContextValue {
  readonly handle: { readonly displayName: string };
  /** What `useOverlay` returns. */
  readonly overlay: Control;
}

export const InstanceContext = createContext<InstanceContextValue | null>(null);
InstanceContext.displayName = "OverlayInstance";

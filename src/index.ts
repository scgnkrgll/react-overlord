"use client";

/**
 * Type-safe, headless manager for modals, menus, toasts and other overlays.
 *
 * @example
 * ```tsx
 * import { createOverlayManager } from "react-overlord";
 *
 * export const overlays = createOverlayManager({
 *   layers: { modal: {}, toast: { limit: 3 } },
 * });
 * ```
 *
 * Toast piles that expand on hover live in the `react-overlord/stack` subpath.
 *
 * @module
 */

export { createOverlayManager } from "./createOverlayManager.tsx";
export type { OverlayManagerConfig } from "./createOverlayManager.tsx";
export { useOverlay } from "./useOverlay.ts";
export type {
  CreateOverlayOptions,
  LayerConfig,
  LayerContainerProps,
  LayerNames,
  OnSubmit,
  OpenArgs,
  OpenAsyncArgs,
  OpenAsyncOptions,
  OpenCallbacks,
  OverlayControl,
  OverlayHandle,
  OverlayInstance,
  OverlayManager,
  OverlayPhase,
  OverlayResult,
  OverlayState,
  OverlayView,
  SubmitContext,
  SubmitFn,
} from "./types.ts";

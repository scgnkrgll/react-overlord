import type { ComponentType, ReactNode } from "react";

/** The state an overlay reads from `useOverlay()`. */
export type OverlayState =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly abortable: boolean }
  | { readonly phase: "failed"; readonly error: unknown }
  | { readonly phase: "closing" };

export type OverlayPhase = OverlayState["phase"];

interface BaseLayerConfig {
  /** Maximum number of active (not closing) overlays in this layer. Unlimited when omitted. */
  readonly limit?: number;
  /** What happens when `limit` is reached. Defaults to `"queue"`. */
  readonly overflow?: "queue" | "dismiss-oldest";
}

/** Props the manager passes to a layer's `container`. */
export interface LayerContainerProps {
  /** The rendered overlays of this layer. */
  readonly children?: ReactNode;
  /**
   * Views of the same overlays, oldest first. Queued overlays are left out; closing ones are
   * included. The array keeps its identity while nothing in the layer changes.
   */
  readonly overlays: ReadonlyArray<OverlayView>;
}

export interface LayerConfig extends BaseLayerConfig {
  /**
   * Wraps every overlay of this layer. Always rendered, so it works as an `aria-live` region.
   * Receives the layer's overlays, which is what `useStack()` from "react-overlord/stack" reads.
   */
  readonly container?: ComponentType<LayerContainerProps>;
}

export interface CreateOverlayOptions {
  /**
   * Keep the overlay mounted in the `closing` phase until it calls `exited()`,
   * so it can play an exit animation. Without it, closing unmounts immediately.
   */
  readonly exitTransition?: boolean;
  /**
   * With `exitTransition`, removes the overlay this many ms after it starts closing, even if it
   * never called `exited()`. Covers a missing `exited()` call and animations that don't run, such
   * as in a background tab. Defaults to 1000. Pass `Infinity` to wait for `exited()` forever.
   */
  readonly exitTimeout?: number;
  /**
   * Name used in `useOverlay()` error messages. Defaults to the component's
   * `displayName` or `name`, which minifiers can rename in production builds.
   */
  readonly displayName?: string;
}

type IsVoid<V> = [V] extends [void] ? true : false;

export interface SubmitContext {
  /** Aborted when an `abortable` overlay is dismissed while pending. */
  readonly signal: AbortSignal;
}

/**
 * Return a promise to keep the overlay pending until it settles. A rejection moves it to `failed`.
 * `openAsync()` puts the awaited return value in `result`.
 */
export type OnSubmit<V, R = unknown> = (value: V, context: SubmitContext) => R;

interface BaseCallbacks {
  /** Called exactly once when the overlay closes for any reason other than a successful submit. */
  readonly onDismiss?: () => void;
  /** Allow `dismiss()` while `onSubmit` is pending. The submit's signal is aborted. */
  readonly abortable?: boolean;
}

/** Callbacks for `open()`. `onSubmit` is required when the overlay submits a value. */
export type OpenCallbacks<V> =
  IsVoid<V> extends true
    ? BaseCallbacks & { readonly onSubmit?: OnSubmit<V> }
    : BaseCallbacks & { readonly onSubmit: OnSubmit<V> };

/** Arguments of `Handle.open()`. Props are optional only when every prop is optional and no callback is required. */
export type OpenArgs<P, V> =
  IsVoid<V> extends true
    ? {} extends P
      ? [props?: P, callbacks?: OpenCallbacks<V>]
      : [props: P, callbacks?: OpenCallbacks<V>]
    : [props: P, callbacks: OpenCallbacks<V>];

/** Options for `openAsync()`. The promise replaces `onDismiss`. */
export interface OpenAsyncOptions<V, R = unknown> {
  /** Its awaited return value becomes the result's `result`. A rejection keeps the overlay open in `failed`. */
  readonly onSubmit?: OnSubmit<V, R>;
  /** Allow `dismiss()` while `onSubmit` is pending. The submit's signal is aborted. */
  readonly abortable?: boolean;
}

/** Arguments of `Handle.openAsync()`. Props are optional only when every prop is optional. */
export type OpenAsyncArgs<P, V, R = V> = {} extends P
  ? [props?: P, options?: OpenAsyncOptions<V, R>]
  : [props: P, options?: OpenAsyncOptions<V, R>];

/**
 * What `openAsync()` resolves to. It never rejects: a dismiss resolves with `submitted: false`.
 * `value` is what the overlay submitted. `result` is what `onSubmit` returned, awaited, and
 * `undefined` without `onSubmit`.
 */
export type OverlayResult<V, R = undefined> =
  | { readonly submitted: true; readonly value: V; readonly result: R }
  | { readonly submitted: false };

export type SubmitFn<V> = IsVoid<V> extends true ? () => void : (value: V) => void;

/** What `useOverlay(Handle)` returns inside the overlay component. */
export interface OverlayControl<V> {
  /** This overlay's id, the same as in `useOverlays()`. Stable while it is open. */
  readonly id: number;
  readonly state: OverlayState;
  /** Hands the value to the caller's `onSubmit`. Ignored unless the phase is `idle` or `failed`. */
  readonly submit: SubmitFn<V>;
  /** Closes without submitting. Ignored while pending unless the caller opened it as `abortable`. */
  readonly dismiss: () => void;
  /** Tells the manager the exit animation finished. Only used with `exitTransition: true`. */
  readonly exited: () => void;
}

/** A single open overlay, returned by `Handle.open()`. */
export interface OverlayInstance<P> {
  /** Replaces all props. The overlay is not remounted. */
  update(props: P): void;
  /** Same rules as the overlay's own `dismiss()`. */
  dismiss(): void;
}

/** Returned by `createOverlay`. The only way to open the overlay. */
export interface OverlayHandle<P, V> {
  readonly displayName: string;
  open(...args: OpenArgs<P, V>): OverlayInstance<P>;
  /**
   * Opens the overlay and resolves once it closes. After a successful submit it resolves with the
   * submitted `value` and the awaited `result` of `onSubmit`. A dismiss resolves with
   * `submitted: false`. Use `open()` to update or dismiss it from outside.
   */
  openAsync<R = undefined>(...args: OpenAsyncArgs<P, V, R>): Promise<OverlayResult<V, Awaited<R>>>;
  /** Type-only carrier for `useOverlay`. Never set at runtime. */
  readonly "~types"?: { readonly props: P; readonly value: V };
}

/** A read-only view of an open overlay, returned by `getOverlays()` and `useOverlays()`. */
export interface OverlayView<L extends string = string> {
  readonly id: number;
  readonly layer: L;
  readonly handle: OverlayHandle<any, any>;
  readonly props: unknown;
  readonly state: OverlayState;
}

export type LayerNames<Layers> = Extract<keyof Layers, string>;

export interface OverlayManager<Layers extends Record<string, LayerConfig>> {
  createOverlay<P, V = void>(
    layer: LayerNames<Layers>,
    component: ComponentType<P>,
    options?: CreateOverlayOptions,
  ): OverlayHandle<P, V>;
  /** Renders every open overlay. Mount once, inside your app's providers. */
  readonly Outlet: ComponentType;
  /** Dismisses every overlay, or only those in `layer`. Same rules as `dismiss()`. */
  dismissAll(layer?: LayerNames<Layers>): void;
  /**
   * Read-only views of every rendered overlay, for code outside React.
   * Queued overlays are not included; closing ones are, with `phase: "closing"`.
   */
  getOverlays(): ReadonlyArray<OverlayView<LayerNames<Layers>>>;
  /** Reactive `getOverlays()`: re-renders when any overlay opens, changes state or closes. */
  useOverlays(): ReadonlyArray<OverlayView<LayerNames<Layers>>>;
  /**
   * Removes every overlay at once, for tests. Unlike `dismissAll()`, it calls no callbacks,
   * skips exit animations, and aborts pending submits. Pending `openAsync()` promises
   * resolve with `submitted: false`.
   */
  reset(): void;
}

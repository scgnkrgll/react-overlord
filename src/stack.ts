"use client";

/**
 * Toast piles for react-overlord: overlays overlap with the newest in front, and hovering or
 * focusing the group spreads them into a list. Built only on the public API: a layer's container
 * receives its `overlays`, and these hooks turn them into positions.
 *
 * @example
 * ```tsx
 * import { StackProvider, useStack, useStackItem } from "react-overlord/stack";
 *
 * function ToastGroup({ children, overlays }: LayerContainerProps) {
 *   const stack = useStack(overlays);
 *   return (
 *     <ol {...stack.props}>
 *       <StackProvider stack={stack}>{children}</StackProvider>
 *     </ol>
 *   );
 * }
 *
 * function Toast({ message }: { message: string }) {
 *   const { id } = useOverlay(ToastOverlay);
 *   const item = useStackItem(id);
 *   return <li ref={item.ref} style={{ "--offset": `${item.offset}px` }}>{message}</li>;
 * }
 * ```
 *
 * @module
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import type { OverlayView } from "./types.ts";

/** Where an overlay sits in its pile. Read it with `useStackItem(id)`. */
export interface StackItem {
  /** 0 is the newest overlay, at the front of the pile. */
  readonly index: number;
  /** Number of active overlays in the pile. Closing overlays don't count. */
  readonly count: number;
  /** True while the group is hovered or focused. */
  readonly expanded: boolean;
  /** True while expanded or while the page is hidden. Pause auto-dismiss timers on this. */
  readonly paused: boolean;
  /** Sum of the measured heights of the newer overlays, in px. Add your gap in CSS. */
  readonly offset: number;
  /** Attach to the element to measure. Heights come from layout, so transforms like `scale` don't change them. */
  readonly ref: (element: HTMLElement | null) => void;
}

/** What `useStack()` returns for the group. */
export interface Stack {
  readonly expanded: boolean;
  readonly paused: boolean;
  readonly count: number;
  /** Height of the front overlay (index 0), for sizing the collapsed pile. */
  readonly frontHeight: number;
  /** Spread on the group's root element, so hover and focus expand the pile. */
  readonly props: {
    readonly onPointerEnter: PointerEventHandler<HTMLElement>;
    readonly onPointerLeave: PointerEventHandler<HTMLElement>;
    readonly onFocus: FocusEventHandler<HTMLElement>;
    readonly onBlur: FocusEventHandler<HTMLElement>;
  };
}

type Items = ReadonlyMap<number, StackItem>;

/** The per-overlay positions behind each `Stack`, kept off the public object. */
const itemsOf = new WeakMap<Stack, Items>();
const StackContext = createContext<Items | null>(null);
StackContext.displayName = "OverlayStack";

const isActive = (overlay: OverlayView) => overlay.state.phase !== "closing";

/** Border box matches offsetHeight, so padding and border changes re-measure too. */
const OBSERVE_OPTIONS: ResizeObserverOptions = { box: "border-box" };

/**
 * Tracks a pile for a layer's container. Pass the container's `overlays` prop, spread
 * `stack.props` on the group's root, and wrap the children in `<StackProvider stack={stack}>`.
 */
export function useStack(overlays: ReadonlyArray<OverlayView>): Stack {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map());

  // When the last overlay goes, its content unmounts and the pointer-leave that would collapse
  // the group never fires, so reset then. Only on that change: hovering an already-empty group
  // must stick, so a toast opened under the cursor starts paused.
  const [lastLength, setLastLength] = useState(overlays.length);
  if (overlays.length !== lastLength) {
    setLastLength(overlays.length);
    if (overlays.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setPageHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const measure = useCallback((updates: ReadonlyArray<readonly [id: number, height: number]>) => {
    setHeights((previous) => {
      let next: Map<number, number> | null = null;
      for (const [id, height] of updates) {
        if (previous.get(id) === height) continue;
        next ??= new Map(previous);
        next.set(id, height);
      }
      return next ?? previous;
    });
  }, []);

  const elements = useRef(new Map<number, HTMLElement>());
  const ids = useRef(new WeakMap<Element, number>());
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const current = new ResizeObserver((records) => {
      const updates: [number, number][] = [];
      for (const record of records) {
        const id = ids.current.get(record.target);
        const target = record.target as HTMLElement;
        if (id !== undefined && elements.current.get(id) === target) {
          updates.push([id, record.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight]);
        }
      }
      if (updates.length) measure(updates); // one update for everything that resized together
    });
    observer.current = current;
    // Ref callbacks ran before this effect, so observe what is already mounted.
    for (const element of elements.current.values()) current.observe(element, OBSERVE_OPTIONS);
    return () => {
      current.disconnect();
      observer.current = null;
    };
  }, [measure]);

  // One stable ref per overlay, so items only change when a position does.
  const refs = useRef(new Map<number, (element: HTMLElement | null) => void>());
  const refFor = (id: number) => {
    let ref = refs.current.get(id);
    if (!ref) {
      let attached: HTMLElement | null = null;
      ref = (element) => {
        if (attached) {
          observer.current?.unobserve(attached);
          if (elements.current.get(id) === attached) elements.current.delete(id);
        }
        attached = element;
        if (!element) return;
        elements.current.set(id, element);
        ids.current.set(element, id);
        // offsetHeight ignores transforms, so a scaled-down toast in the pile reports its real height.
        measure([[id, element.offsetHeight]]);
        observer.current?.observe(element, OBSERVE_OPTIONS);
      };
      refs.current.set(id, ref);
    }
    return ref;
  };

  // Closing overlays keep their last position, so they animate out in place.
  const lastPositions = useRef(new Map<number, { index: number; offset: number }>());
  const previousItems = useRef<Items>(new Map());

  const expanded = hovered || focused;
  const paused = expanded || pageHidden;

  const { items, frontHeight, count } = useMemo(() => {
    const active = overlays.filter(isActive).reverse();
    const count = active.length;
    const positions = new Map<number, { index: number; offset: number }>();
    let offset = 0;
    active.forEach((overlay, index) => {
      positions.set(overlay.id, { index, offset });
      offset += heights.get(overlay.id) ?? 0;
    });
    const items = new Map<number, StackItem>();
    for (const overlay of overlays) {
      const position = positions.get(overlay.id) ?? lastPositions.current.get(overlay.id) ?? { index: 0, offset: 0 };
      const old = previousItems.current.get(overlay.id);
      const same =
        old &&
        old.index === position.index &&
        old.offset === position.offset &&
        old.count === count &&
        old.expanded === expanded &&
        old.paused === paused;
      items.set(overlay.id, same ? old : { ...position, count, expanded, paused, ref: refFor(overlay.id) });
    }
    const front = active[0];
    return { items, count, frontHeight: front ? (heights.get(front.id) ?? 0) : 0 };
    // refFor only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, heights, expanded, paused]);

  // Remember positions and drop state for overlays that are gone.
  useEffect(() => {
    previousItems.current = items;
    const present = new Set(overlays.map((overlay) => overlay.id));
    for (const overlay of overlays) {
      const item = items.get(overlay.id);
      if (item && isActive(overlay)) lastPositions.current.set(overlay.id, { index: item.index, offset: item.offset });
    }
    for (const map of [lastPositions.current, refs.current, elements.current] as Map<number, unknown>[]) {
      for (const id of map.keys()) if (!present.has(id)) map.delete(id);
    }
    setHeights((previous) => {
      if ([...previous.keys()].every((id) => present.has(id))) return previous;
      return new Map([...previous].filter(([id]) => present.has(id)));
    });
  }, [items, overlays]);

  const props = useMemo<Stack["props"]>(
    () => ({
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        // Moving focus between overlays in the group keeps it expanded.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
    }),
    [],
  );

  // A new object whenever any position changes, so a memoized container still passes fresh items down.
  return useMemo<Stack>(() => {
    const stack = { expanded, paused, count, frontHeight, props };
    itemsOf.set(stack, items);
    return stack;
  }, [expanded, paused, count, frontHeight, props, items]);
}

/** Makes the pile's positions available to `useStackItem()` in the overlays below it. */
export function StackProvider({ stack, children }: { stack: Stack; children?: ReactNode }): ReactElement {
  const items = itemsOf.get(stack);
  if (!items) throw new Error("StackProvider needs the object returned by useStack().");
  return createElement(StackContext.Provider, { value: items }, children);
}

/** The position of overlay `id` in the pile around it. Pass `useOverlay(Handle).id`. */
export function useStackItem(id: number): StackItem {
  const items = useContext(StackContext);
  if (!items) {
    throw new Error(
      "useStackItem() must be called in an overlay whose layer container renders <StackProvider stack={useStack(overlays)}>.",
    );
  }
  const item = items.get(id);
  if (!item) throw new Error(`useStackItem(${id}): this overlay is not in the surrounding stack.`);
  return item;
}

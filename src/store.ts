import type { LayerConfig, OverlayState } from "./types.ts";

/** `queued` is internal: queued overlays are not rendered. */
type RecordState = OverlayState | { readonly phase: "queued" };

export interface Callbacks {
  onSubmit?: ((value: never, context: { signal: AbortSignal }) => unknown) | undefined;
  onDismiss?: (() => void) | undefined;
  abortable?: boolean | undefined;
  /** Internal: called with the submitted value and onSubmit's result after a successful submit. Backs `openAsync`. */
  onSubmitted?: ((value: unknown, result: unknown) => void) | undefined;
  /** Internal: called by `reset()`, which skips `onDismiss`. Lets `openAsync` settle its promise. */
  onReset?: (() => void) | undefined;
}

export interface OpenRequest<H, C> {
  layer: string;
  handle: H;
  component: C;
  exitTransition: boolean;
  /** With exitTransition: ms after closing starts before the overlay is removed anyway. */
  exitTimeout?: number | undefined;
  props: unknown;
  callbacks: Callbacks;
}

export interface Control {
  readonly id: number;
  readonly state: OverlayState;
  readonly submit: (value?: unknown) => void;
  readonly dismiss: () => void;
  readonly exited: () => void;
}

/** Immutable view of a rendered overlay. Replaced only when that overlay changes. */
export interface Entry<H, C> {
  readonly id: number;
  readonly handle: H;
  readonly component: C;
  readonly props: unknown;
  readonly control: Control;
}

/** One layer of a snapshot. Keeps its identity while none of its entries change. */
export interface LayerSnapshot<H, C> {
  readonly layer: string;
  readonly entries: ReadonlyArray<Entry<H, C>>;
}

export type Snapshot<H, C> = ReadonlyArray<LayerSnapshot<H, C>>;

interface OverlayRecord<H, C> {
  readonly id: number;
  readonly request: OpenRequest<H, C>;
  props: unknown;
  state: RecordState;
  /** The in-flight submit attempt, if any. Identity doubles as the stale-attempt check. */
  controller: AbortController | null;
  fns: Omit<Control, "state">;
  control: Control | null;
  entry: Entry<H, C> | null;
  /** Removes a closing overlay that never called exited(). */
  exitTimer?: ReturnType<typeof setTimeout>;
}

/** Whether an overlay counts toward its layer's limit (not queued, not closing). */
const isActive = (state: RecordState) =>
  state.phase === "idle" || state.phase === "pending" || state.phase === "failed";

const DEFAULT_EXIT_TIMEOUT = 1000;

/** Surface a caller callback error without breaking the store or skipping other callbacks. */
const reportAsync = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Framework-agnostic overlay state. Every transition goes through a method below
 * and follows the state table in the README. Events that don't apply are no-ops.
 */
export class OverlayStore<H, C> {
  private readonly layers: ReadonlyMap<string, LayerConfig>;
  private readonly records = new Map<number, OverlayRecord<H, C>>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private snapshot: Snapshot<H, C>;
  /** Callbacks run after the transition is applied and listeners are notified. */
  private effects: Array<() => void> = [];
  private batchDepth = 0;
  private changed = false;

  constructor(layers: Record<string, LayerConfig>) {
    for (const [name, config] of Object.entries(layers)) {
      const { limit } = config;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error(`Layer "${name}": limit must be a positive integer, got ${limit}.`);
      }
      // Only the removed `stack: true` form; `stack: false` / `undefined` were always no-ops.
      if ((config as { stack?: unknown }).stack === true) {
        throw new Error(
          `Layer "${name}": "stack: true" was removed in 0.3. Give the layer a container that calls useStack() from "react-overlord/stack".`,
        );
      }
    }
    this.layers = new Map(Object.entries(layers));
    this.snapshot = this.buildSnapshot();
  }

  hasLayer(layer: string): boolean {
    return this.layers.has(layer);
  }

  layerConfig(layer: string): LayerConfig | undefined {
    return this.layers.get(layer);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot<H, C> => this.snapshot;

  open(request: OpenRequest<H, C>): number {
    return this.batch(() => {
      const id = this.nextId++;
      const record: OverlayRecord<H, C> = {
        id,
        request,
        props: request.props,
        state: { phase: "queued" },
        controller: null,
        fns: {
          id,
          submit: (value) => this.submit(id, value),
          dismiss: () => this.dismiss(id),
          exited: () => this.exited(id),
        },
        control: null,
        entry: null,
      };
      this.records.set(id, record);

      const { limit, overflow = "queue" } = this.layers.get(request.layer) ?? {};
      if (limit !== undefined && overflow === "dismiss-oldest") {
        const active = this.activeIn(request.layer);
        const oldest = active.length >= limit ? active.find((r) => r.state.phase !== "pending") : undefined;
        if (oldest) this.dismiss(oldest.id);
      }
      this.promote(request.layer);
      return id;
    });
  }

  update(id: number, props: unknown): void {
    const record = this.records.get(id);
    if (!record) return;
    this.batch(() => {
      record.props = props;
      this.touch(record);
    });
  }

  submit(id: number, value: unknown): void {
    const record = this.records.get(id);
    if (!record || (record.state.phase !== "idle" && record.state.phase !== "failed")) return;

    this.batch(() => {
      const { onSubmit, onSubmitted, abortable = false } = record.request.callbacks;
      // `openAsync` resolves with the result: onSubmit's return value, or the submitted value without one.
      const succeed = (result: unknown) => {
        if (onSubmitted) this.effects.push(() => onSubmitted(value, result));
        this.close(record);
      };
      if (!onSubmit) {
        succeed(undefined);
        return;
      }

      // Mark the attempt in flight before invoking caller code: a reentrant submit is ignored,
      // and a dismiss-oldest open can't evict this overlay while its handler runs. Inside this
      // batch, so a synchronous handler still closes without anyone seeing a pending flash.
      const controller = new AbortController();
      record.controller = controller;
      this.setState(record, { phase: "pending", abortable });
      const isCurrent = () => this.records.get(id) === record && record.controller === controller;
      const fail = (error: unknown) => {
        if (!isCurrent()) return;
        record.controller = null;
        this.setState(record, { phase: "failed", error });
      };

      let result: unknown;
      try {
        result = (onSubmit as (value: unknown, context: { signal: AbortSignal }) => unknown)(value, {
          signal: controller.signal,
        });
      } catch (error) {
        fail(error);
        return;
      }

      // The handler may have dismissed its own overlay (when abortable). Returned thenables are
      // still consumed below so their rejections are handled, but only a current attempt changes state.
      let then: unknown;
      try {
        then =
          (typeof result === "object" && result !== null) || typeof result === "function"
            ? (result as PromiseLike<unknown>).then
            : undefined;
      } catch (error) {
        // A throwing `then` getter is a rejection.
        fail(error);
        return;
      }
      if (typeof then !== "function") {
        if (isCurrent()) succeed(result);
        return;
      }
      // Assimilate through a native promise: a throwing then() call, multiple settlements and
      // nested thenables all behave like a real promise, and stale rejections stay handled.
      Promise.resolve(result).then(
        (resolved) => {
          if (isCurrent()) this.batch(() => succeed(resolved));
        },
        (error: unknown) => this.batch(() => fail(error)),
      );
    });
  }

  dismiss(id: number): void {
    const record = this.records.get(id);
    if (!record) return;
    const { state } = record;
    if (state.phase === "closing" || (state.phase === "pending" && !state.abortable)) return;

    this.batch(() => {
      // Re-check inside the batch: an abort listener may have reentered dismissal.
      if (this.records.get(id) !== record) return;
      const current = record.state;
      if (current.phase === "closing" || (current.phase === "pending" && !current.abortable)) return;
      const controller = record.controller;
      const { onDismiss } = record.request.callbacks;
      if (onDismiss) this.effects.push(onDismiss);
      if (current.phase === "queued") this.remove(record);
      else this.close(record);
      // Abort last: abort listeners dispatch synchronously and may reenter, so they must
      // already see terminal state. The signal is aborted before dismiss() returns.
      controller?.abort();
    });
  }

  exited(id: number): void {
    const record = this.records.get(id);
    if (!record || record.state.phase !== "closing") return;
    this.batch(() => this.remove(record));
  }

  dismissAll(layer?: string): void {
    this.batch(() => {
      const targets = [...this.records.values()].filter((r) => layer === undefined || r.request.layer === layer);
      // Queued first, so dismissing an active overlay doesn't promote one we're about to dismiss.
      const queued = targets.filter((r) => r.state.phase === "queued");
      const rest = targets.filter((r) => r.state.phase !== "queued");
      for (const record of [...queued, ...rest]) this.dismiss(record.id);
    });
  }

  reset(): void {
    this.batch(() => {
      for (const record of this.records.values()) {
        if (record.exitTimer !== undefined) clearTimeout(record.exitTimer);
        const controller = record.controller;
        record.controller = null;
        const { onReset } = record.request.callbacks;
        if (onReset) this.effects.push(onReset);
        // After the record is gone, so a rejection from the aborted submit changes nothing.
        if (controller) this.effects.push(() => controller.abort());
      }
      this.records.clear();
      this.changed = true;
    });
  }

  private close(record: OverlayRecord<H, C>): void {
    record.controller = null;
    if (record.request.exitTransition) {
      this.setState(record, { phase: "closing" });
      this.scheduleExitTimeout(record);
      // Closing overlays don't count toward the limit, so a queued one can enter while this one animates out.
      this.promote(record.request.layer);
    } else {
      this.remove(record); // promotes the layer itself
    }
  }

  private scheduleExitTimeout(record: OverlayRecord<H, C>): void {
    const ms = record.request.exitTimeout ?? DEFAULT_EXIT_TIMEOUT;
    if (!Number.isFinite(ms)) return;
    record.exitTimer = setTimeout(() => this.exited(record.id), Math.max(0, ms));
    // Don't keep a Node process alive just for this timer.
    (record.exitTimer as unknown as { unref?: () => void }).unref?.();
  }

  private remove(record: OverlayRecord<H, C>): void {
    if (record.exitTimer !== undefined) clearTimeout(record.exitTimer);
    this.records.delete(record.id);
    this.changed = true;
    this.promote(record.request.layer);
  }

  private promote(layer: string): void {
    const { limit } = this.layers.get(layer) ?? {};
    let free = limit === undefined ? Infinity : limit - this.activeIn(layer).length;
    for (const record of this.records.values()) {
      if (free <= 0) break;
      if (record.request.layer === layer && record.state.phase === "queued") {
        this.setState(record, { phase: "idle" });
        free--;
      }
    }
  }

  private activeIn(layer: string): OverlayRecord<H, C>[] {
    return [...this.records.values()].filter((r) => r.request.layer === layer && isActive(r.state));
  }

  private setState(record: OverlayRecord<H, C>, state: RecordState): void {
    record.state = state;
    this.touch(record);
  }

  private touch(record: OverlayRecord<H, C>): void {
    record.entry = null;
    this.changed = true;
  }

  /** Groups nested transitions so listeners are notified once, then runs queued callbacks. */
  private batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      // Flush even when fn threw: pending changes and callbacks must not leak into a later batch.
      if (this.batchDepth === 0) this.flush();
    }
  }

  private flush(): void {
    if (this.changed) {
      this.changed = false;
      this.snapshot = this.buildSnapshot();
      for (const listener of this.listeners) {
        try {
          listener();
        } catch (error) {
          reportAsync(error);
        }
      }
    }
    const effects = this.effects;
    this.effects = [];
    for (const effect of effects) {
      try {
        effect();
      } catch (error) {
        reportAsync(error);
      }
    }
  }

  private buildSnapshot(): Snapshot<H, C> {
    const previous = this.snapshot as Snapshot<H, C> | undefined;
    return [...this.layers.keys()].map((layer, index) => {
      const entries: Entry<H, C>[] = [];
      for (const record of this.records.values()) {
        if (record.request.layer === layer && record.state.phase !== "queued") entries.push(this.entryOf(record));
      }
      // Reuse the layer object while its entries are the same, so the layer's container and
      // `useStack()` don't recompute when only another layer changed.
      const old = previous?.[index];
      if (old && old.entries.length === entries.length && old.entries.every((entry, i) => entry === entries[i])) {
        return old;
      }
      return { layer, entries };
    });
  }

  private entryOf(record: OverlayRecord<H, C>): Entry<H, C> {
    if (record.entry) return record.entry;
    // Queued records are filtered out before this is called.
    const state = record.state as OverlayState;
    // Keep the control object stable across prop-only updates.
    if (record.control?.state !== state) record.control = { state, ...record.fns };
    record.entry = {
      id: record.id,
      handle: record.request.handle,
      component: record.request.component,
      props: record.props,
      control: record.control,
    };
    return record.entry;
  }
}

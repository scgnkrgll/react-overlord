import {
  Fragment,
  memo,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { InstanceContext, type InstanceContextValue } from "./context.ts";
import { OverlayStore, type Callbacks, type Entry, type LayerSnapshot } from "./store.ts";
import type {
  CreateOverlayOptions,
  LayerConfig,
  LayerContainerProps,
  LayerNames,
  OpenAsyncOptions,
  OverlayHandle,
  OverlayInstance,
  OverlayManager,
  OverlayResult,
  OverlayView,
} from "./types.ts";

type AnyHandle = OverlayHandle<any, any>;
type AnyComponent = ComponentType<Record<string, unknown>>;

export interface OverlayManagerConfig<Layers extends Record<string, LayerConfig>> {
  /** Named layers. Declaration order is render order: later layers draw on top. */
  readonly layers: Layers;
}

export function createOverlayManager<const Layers extends Record<string, LayerConfig>>(
  config: OverlayManagerConfig<Layers>,
): OverlayManager<Layers> {
  const store = new OverlayStore<AnyHandle, AnyComponent>(config.layers);

  function createOverlay(
    layer: string,
    component: ComponentType<never>,
    options: CreateOverlayOptions = {},
  ): AnyHandle {
    if (!store.hasLayer(layer)) {
      throw new Error(`Unknown overlay layer "${layer}". Declared layers: ${Object.keys(config.layers).join(", ")}.`);
    }
    const start = (props: unknown, callbacks: Callbacks) =>
      store.open({
        layer,
        handle,
        component: component as AnyComponent,
        exitTransition: options.exitTransition ?? false,
        exitTimeout: options.exitTimeout,
        props: props ?? {},
        callbacks,
      });
    const handle: AnyHandle = {
      displayName: options.displayName ?? component.displayName ?? (component.name || "Overlay"),
      open(props?: unknown, callbacks?: Callbacks): OverlayInstance<unknown> {
        const id = start(props, callbacks ?? {});
        return {
          update: (next) => store.update(id, next),
          dismiss: () => store.dismiss(id),
        };
      },
      openAsync(props?: unknown, { onSubmit, abortable }: OpenAsyncOptions<unknown> = {}) {
        return new Promise<OverlayResult<any, any>>((resolve) => {
          start(props, {
            onSubmit,
            abortable,
            onSubmitted: (value, result) => resolve({ submitted: true, value, result }),
            onDismiss: () => resolve({ submitted: false }),
            onReset: () => resolve({ submitted: false }),
          });
        });
      },
    };
    return handle;
  }

  // One view array per layer snapshot. Layer snapshots keep their identity while unchanged,
  // so the views (and the containers that read them) do too.
  const layerViews = new WeakMap<LayerSnapshot<AnyHandle, AnyComponent>, ReadonlyArray<OverlayView>>();
  const viewsOf = (layer: LayerSnapshot<AnyHandle, AnyComponent>) => {
    let views = layerViews.get(layer);
    if (!views) {
      views = layer.entries.map((entry) => ({
        id: entry.id,
        layer: layer.layer,
        handle: entry.handle,
        props: entry.props,
        state: entry.control.state,
      }));
      layerViews.set(layer, views);
    }
    return views;
  };
  const toViews = (snapshot: ReadonlyArray<LayerSnapshot<AnyHandle, AnyComponent>>) =>
    snapshot.flatMap(viewsOf) as unknown as ReadonlyArray<OverlayView<LayerNames<Layers>>>;

  function useOverlays() {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    // The snapshot is referentially stable while nothing changed, and so is this view.
    return useMemo(() => toViews(snapshot), [snapshot]);
  }

  function Outlet() {
    const layers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    return (
      <>
        {layers.map((layer) => {
          const children = layer.entries.map((entry) => <InstanceView key={entry.id} entry={entry} />);
          const Container = store.layerConfig(layer.layer)!.container as ComponentType<LayerContainerProps> | undefined;
          if (!Container) return <Fragment key={layer.layer}>{children}</Fragment>;
          return (
            <Container key={layer.layer} overlays={viewsOf(layer)}>
              {children}
            </Container>
          );
        })}
      </>
    );
  }

  return {
    createOverlay: createOverlay as OverlayManager<Layers>["createOverlay"],
    Outlet,
    dismissAll: (layer) => store.dismissAll(layer),
    getOverlays: () => toViews(store.getSnapshot()),
    useOverlays,
    reset: () => store.reset(),
  };
}

/** Re-renders only when this overlay's entry changes, not when another overlay does. */
const InstanceView = memo(function InstanceView({ entry }: { entry: Entry<AnyHandle, AnyComponent> }) {
  const { handle, control, component: Component } = entry;
  const value = useMemo<InstanceContextValue>(() => ({ handle, overlay: control }), [handle, control]);
  return (
    <InstanceContext.Provider value={value}>
      <Component {...(entry.props as Record<string, unknown>)} />
    </InstanceContext.Provider>
  );
});

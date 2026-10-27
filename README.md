# react-overlord

[![npm](https://img.shields.io/npm/v/react-overlord)](https://www.npmjs.com/package/react-overlord)
[![JSR](https://jsr.io/badges/@scgnkrgll/react-overlord)](https://jsr.io/@scgnkrgll/react-overlord)

A type-safe, headless manager for modals, drawers, context menus and other overlays that render above your app.

Use it when overlays are reused across an app, return data, or run async work that can fail.

- **Typed end to end.** `open()` knows the overlay's props and the type it submits. `useOverlay()` knows the same types.
- **Async work keeps the user's input.** While the caller's `onSubmit` runs, the overlay stays open and can disable itself. If `onSubmit` fails, the overlay stays open with the user's input and shows the error, so the user can retry.
- **One way to do each thing.** Open with `Handle.open()`, or with `Handle.openAsync()` to `await` the result. Finish with `submit()` or `dismiss()`. There are no aliases.
- **Headless.** You render the UI with antd, MUI or plain HTML. The library manages state and decides what is mounted.

## Install

```sh
npm i react-overlord                    # npm, pnpm, yarn or bun
npx jsr add @scgnkrgll/react-overlord   # JSR
deno add jsr:@scgnkrgll/react-overlord  # Deno
```

It requires React 18 or later. The package has a `"use client"` directive, so it works in the Next.js App Router.

The manager is a module-level singleton. Call `open()` only from event handlers and effects. If you open an overlay during server-side rendering, every request shares that overlay state.

## Setup

```tsx
// overlays.ts
import { createOverlayManager } from "react-overlord";

export const overlays = createOverlayManager({
  layers: {                                              // later layers draw on top of earlier ones
    modal: {},                                           // no limit
    menu:  { limit: 1, overflow: "dismiss-oldest" },     // a new menu replaces the old one
  },
});
```

```tsx
// App.tsx: mount once, inside your theme, router and query providers so overlays can use them
<ThemeProvider>
  <Routes />
  <overlays.Outlet />
</ThemeProvider>
```

A layer's rules apply to every overlay in it. For example, two different menu components can never be open at the same time. For toasts that pile up and expand on hover, see [Stacked layers](#stacked-layers).

| Layer option | Meaning |
|---|---|
| `limit` | Maximum number of active overlays. Closing overlays don't count. |
| `overflow` | What happens at the limit. `"queue"` (the default) waits for a free slot. `"dismiss-oldest"` dismisses the oldest overlay that isn't pending. If every active overlay is pending, it queues the new one. |
| `container` | A component that wraps the layer. The manager always renders it, so it works as an `aria-live` region. It receives `children` and `overlays`, the layer's rendered overlays in the same form as [`useOverlays()`](#reading-open-overlays). |

## Defining an overlay

```tsx
type UserModalProps = { user?: User };

export const UserModal = overlays.createOverlay<UserModalProps, User>("modal", UserInfoModal, {
  exitTransition: true,
});

function UserInfoModal({ user }: UserModalProps) {
  const { state, submit, dismiss, exited } = useOverlay(UserModal);
  const [form] = Form.useForm();

  return (
    <Modal
      open={state.phase !== "closing"}
      afterClose={exited}
      confirmLoading={state.phase === "pending"}
      onCancel={dismiss}
      onOk={() => form.validateFields().then(submit)}
    >
      {state.phase === "failed" && <Alert type="error" message={String(state.error)} />}
      <Form form={form} disabled={state.phase === "pending"} initialValues={user}>…</Form>
    </Modal>
  );
}
```

This example uses antd. The demo app builds the same overlays with shadcn/ui on Base UI.

- `createOverlay<Props, Value = void>(layer, Component, options?)`. `Value` is the type the overlay submits. `layer` must be a declared layer name, and `Component`'s props must match `Props`.
- `useOverlay(Handle)` works only inside that handle's component. Anywhere else, including inside a different overlay, it throws an error that names the overlay. A component belongs to exactly one handle.
- `exitTransition: true` keeps the overlay mounted in `closing` until it calls `exited()`. Without it, the overlay unmounts as soon as it closes.
- `exitTimeout` removes a closing overlay after this many milliseconds, even if it never calls `exited()`. It defaults to 1000. This covers a forgotten `exited()` call and animations that don't run, such as in a background tab. Pass `Infinity` to wait for `exited()` forever.
- `displayName` sets the name used in those errors. It defaults to the component's `displayName` or `name`, which minifiers can rename in production builds.

## Opening

```tsx
const instance = UserModal.open({ user }, {
  onSubmit: (user, { signal }) => api.saveUser(user),  // return a promise to stay pending until it settles
  onDismiss: () => {},
});

instance.update({ user: other });  // replaces all props without remounting
instance.dismiss();

overlays.dismissAll();             // or overlays.dismissAll("toast")
```

You can call `open` anywhere, including in components, event handlers, and an API interceptor outside React.

| Value | `useOverlay().submit` | `open()` callbacks |
|---|---|---|
| a type, such as `User` | `submit(user)` | `onSubmit` is **required**, so no caller can ignore a submitted value |
| `void` (the default) | `submit()` | All optional. Without `onSubmit`, a void overlay closes when it submits. |

The manager reads the callbacks once, when you call `open`. If a callback needs a value that changes while the overlay is open, read it from a ref or a store.

### Awaiting the result

`openAsync` returns a promise instead of an instance. The promise resolves when the overlay closes and never rejects.

```tsx
const result = await Confirm.openAsync({ text: "Delete?" });
if (!result.submitted) return;

const edited = await UserModal.openAsync({ user }, {
  onSubmit: (user, { signal }) => api.saveUser(user, { signal }),  // optional; a failure keeps the overlay open
});
if (edited.submitted) {
  edited.value;   // User: what the overlay submitted
  edited.result;  // what saveUser returned, awaited
}
```

| Outcome | Resolves with |
|---|---|
| The submit succeeds: `onSubmit` returned, or its promise resolved | `{ submitted: true, value, result }`. `value` is what the overlay submitted. `result` is the awaited return value of `onSubmit`, and `undefined` without `onSubmit`. |
| The overlay was dismissed, evicted by `dismiss-oldest`, or an `abortable` submit was aborted | `{ submitted: false }` |

With `openAsync`, `onSubmit` is optional even when the overlay submits a value. It doesn't accept `onDismiss`, because the promise reports dismissal. A failed `onSubmit` doesn't settle the promise. The overlay stays open in `failed` so the user can retry. The promise resolves as soon as the overlay closes, so the caller can open the next overlay right away. With `exitTransition`, that is when the exit animation starts, not when it ends. To update or dismiss the overlay from outside, use `open()`.

> **New in 0.3.** The result has a `result` field with what `onSubmit` returned. `value` is still the submitted value.

### Aborting a pending submit

By default, the user can't dismiss an overlay while `onSubmit` is pending. The caller can allow it:

```tsx
Confirm.open({ text: "Delete?" }, {
  abortable: true,
  onSubmit: (_, { signal }) => api.delete(id, { signal }),
});
```

The pending state then has `abortable: true`, so the overlay can keep its Cancel button enabled. A dismiss aborts the signal, closes the overlay and calls `onDismiss`. The manager ignores the rejection from the aborted request.

## Reading open overlays

`overlays.useOverlays()` is a hook, and `overlays.getOverlays()` works anywhere. Both return a read-only view of each rendered overlay, with `{ id, layer, handle, props, state }`. The list leaves out queued overlays and includes closing ones, which have `phase: "closing"`.

```tsx
function useBlocker() {
  // Block navigation while any overlay is waiting on async work.
  return overlays.useOverlays().some((o) => o.state.phase === "pending");
}
```

## State machine

This is the state an overlay reads from `useOverlay()`:

```ts
type OverlayState =
  | { phase: "idle" }
  | { phase: "pending"; abortable: boolean }
  | { phase: "failed"; error: unknown }
  | { phase: "closing" };
```

| From | Event | To |
|---|---|---|
| start | `open()` | `idle`, or queued and not rendered when the layer is full |
| queued | a slot frees up | `idle` |
| queued | dismiss | removed, and `onDismiss` runs |
| idle or failed | `submit(v)` | The manager calls `onSubmit(v, { signal })`. A returned promise moves the overlay to `pending`, a sync return moves it to `closing`, and a sync throw moves it to `failed`. Without `onSubmit`, it moves to `closing`. |
| pending | the promise resolves | `closing` |
| pending | the promise rejects | `failed`. The overlay stays mounted, so local state and form input survive. |
| pending | submit | ignored |
| pending | dismiss | Ignored, unless `abortable`. Then the signal aborts, the overlay moves to `closing`, and `onDismiss` runs. |
| idle or failed | dismiss, `dismissAll`, or eviction | `closing`, and `onDismiss` runs |
| closing | `exited()`, `exitTimeout`, or right away without `exitTransition` | removed |

The manager guarantees the following.

- Every `open()` ends in exactly one way. Either `onSubmit` succeeds or `onDismiss` runs.
- Events missing from the table do nothing.
- The error stays until the next `submit`.
- The manager never remounts an open overlay.
- Callbacks run after the state updates, so they can open other overlays.

## Stacked layers

The `react-overlord/stack` subpath turns a layer into a pile, like Ark UI's toasts. On JSR it is `@scgnkrgll/react-overlord/stack`.

- Overlays overlap, with the newest in front.
- Hovering or focusing the group spreads them into a list.
- Auto-dismiss timers can pause while the pile is expanded.

The hooks track positions and measure heights. Your components and CSS draw the pile. The layer itself is an ordinary layer whose container calls `useStack()`.

```tsx
// overlays.ts
export const overlays = createOverlayManager({
  layers: {
    modal: {},
    toast: { limit: 24, container: ToastGroup },  // a cap in case something opens toasts in a loop
  },
});
```

```tsx
import type { LayerContainerProps } from "react-overlord";
import { StackProvider, useStack, useStackItem } from "react-overlord/stack";

function ToastGroup({ children, overlays }: LayerContainerProps) {
  const stack = useStack(overlays);  // expanded, paused, count, frontHeight and props
  return (
    <ol {...stack.props} data-expanded={stack.expanded} style={{ "--front-height": `${stack.frontHeight}px` }}>
      <StackProvider stack={stack}>{children}</StackProvider>
    </ol>
  );
}

function Toast({ message }: { message: string }) {
  const { id, dismiss } = useOverlay(ToastOverlay);
  const item = useStackItem(id);  // index, count, expanded, paused, offset and ref
  useCountdown(4000, item.paused, dismiss);
  return (
    <li data-expanded={item.expanded} style={{ "--index": item.index, "--offset": `${item.offset}px` }}>
      <div ref={item.ref}>{message}</div>
    </li>
  );
}
```

| Field | Meaning |
|---|---|
| `index` | 0 is the newest overlay, at the front of the pile. |
| `count` | Number of active overlays in the layer. Queued and closing overlays don't count. |
| `offset` | Sum of the measured heights of the newer overlays, in px. Add your gap in CSS, for example `calc(var(--offset) + var(--index) * var(--gap))`. |
| `ref` | Attach it to the element to measure. Heights come from `offsetHeight` and `ResizeObserver`, so transforms like `scale` don't change them. |
| `expanded` | True while the group is hovered or focused. `stack.props` sets it. Moving focus between overlays in the group keeps it true. |
| `paused` | True while `expanded` is true or the page is hidden. Pause timers on it. |
| `stack.frontHeight` | Height of the front overlay. Use it to size the collapsed pile. |

A closing overlay keeps its last `index` and `offset` while it animates out. The other overlays close the gap right away. `useStackItem()` throws if no `StackProvider` is around the overlay.

To try it, click "Fire 5 toasts" in the [live demo](https://scgnkrgll.github.io/react-overlord/#demo) and hover the pile. Its source is in [`Toast.tsx`](https://github.com/scgnkrgll/react-overlord/blob/main/demo/Toast.tsx), [`ToastGroup.tsx`](https://github.com/scgnkrgll/react-overlord/blob/main/demo/ToastGroup.tsx), and [`styles.css`](https://github.com/scgnkrgll/react-overlord/blob/main/demo/styles.css), which has the CSS that draws the pile.

## Testing

The manager lives at module level, so overlays opened in one test are still open in the next. Call `reset()` between tests:

```tsx
afterEach(() => act(() => overlays.reset()));
```

`reset()` removes every overlay at once. It skips exit animations, calls no `onDismiss`, and aborts pending submits. Pending `openAsync()` promises resolve with `{ submitted: false }`. Render `<overlays.Outlet />` next to the component under test so opened overlays appear in the DOM.

## Comparison

This table compares react-overlord with [overlay-kit](https://github.com/toss/overlay-kit) 1.9 and [nice-modal-react](https://github.com/eBay/nice-modal-react) 1.2, based on their published type definitions.

| | react-overlord | overlay-kit | nice-modal-react |
|---|---|---|---|
| Result type | Declared once on the overlay | Annotated on each call with `openAsync<T>()`, otherwise `unknown` | Annotated on each call with `show<T>()`, otherwise `unknown` |
| Awaited result | Typed per overlay: `{ submitted: true, value, result }`, with the submitted value and what `onSubmit` returned, or `{ submitted: false }` | One `close(value)`. You pick a value that means cancel, and `reject` is untyped. | `resolve(unknown)` or `reject(unknown)`. Hiding the modal without calling either leaves the promise pending. |
| Props checked at open | Yes, required props are required | Yes, through JSX in the callback | Partly, because `show()` accepts `Partial<Props>` |
| Callers must handle the result | `onSubmit` is required when the overlay submits a value | No | No |
| Async submit with pending and failed states | Built in, with retry and abort | You build it | You build it |
| Limits, queueing, render order | Per layer | No | No |
| Stacked toasts | Optional hooks in a subpath | No | No |
| Setup | A manager, layers, and `createOverlay` for each overlay | A provider, then inline `open()` | A provider, then `NiceModal.create()` |

Awaiting a result shows the difference:

```tsx
// overlay-kit: close() can't infer T, so every caller has to annotate it
const ok = await overlay.openAsync(({ isOpen, close }) => (
  <Confirm open={isOpen} onOk={() => close(true)} onCancel={() => close(false)} />
));
// ok: unknown

// react-overlord: the type comes from the overlay's definition and the submit handler
const result = await UserModal.openAsync({ user }, {
  onSubmit: (draft) => api.saveUser(draft),
});
if (result.submitted) {
  result.value;   // User, what the overlay submitted
  result.result;  // SavedUser, what saveUser returned
}
```

**When to pick something else.** For a few one-off confirm dialogs, overlay-kit needs less setup, because it has no manager and nothing to register. nice-modal-react has ready-made helpers for antd, MUI and Bootstrap modals.

## Contributing

To run the tests and the demo locally, or to publish a release, see [CONTRIBUTING.md](https://github.com/scgnkrgll/react-overlord/blob/main/CONTRIBUTING.md).

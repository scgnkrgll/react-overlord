import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createOverlayManager, useOverlay, type LayerContainerProps } from "../index.ts";
import { StackProvider, useStack, useStackItem } from "../stack.ts";

function setup({ exitTransition = false } = {}) {
  // jsdom has no layout: report heights from a data attribute, and let tests trigger resizes.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Number(this.dataset.height ?? 0);
  });
  // Each observer tracks its own elements; `observed` is what any live observer still watches.
  const instances: Set<Element>[] = [];
  const observed = {
    get size() {
      return new Set(instances.flatMap((set) => [...set])).size;
    },
    elements: () => new Set(instances.flatMap((set) => [...set])),
  };
  const callbacks: ((entries: ResizeObserverEntry[]) => void)[] = [];
  let disconnected = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly set = new Set<Element>();
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        callbacks.push(callback);
        instances.push(this.set);
      }
      observe(el: Element) {
        this.set.add(el);
      }
      unobserve(el: Element) {
        this.set.delete(el);
      }
      disconnect() {
        disconnected++;
        this.set.clear();
      }
    },
  );
  const resize = (el: HTMLElement, height: number) =>
    act(() => {
      for (const notify of callbacks) notify([{ target: el, borderBoxSize: [{ blockSize: height, inlineSize: 0 }] } as never]);
    });

  function Group({ children, overlays }: LayerContainerProps) {
    const stack = useStack(overlays);
    return (
      <ol
        aria-label="toasts"
        data-expanded={stack.expanded}
        data-count={stack.count}
        data-front={stack.frontHeight}
        {...stack.props}
      >
        <StackProvider stack={stack}>{children}</StackProvider>
      </ol>
    );
  }
  const overlays = createOverlayManager({ layers: { modal: {}, toast: { container: Group } } });
  function Toast({ text, height }: { text: string; height: number }) {
    const { id, dismiss, exited } = useOverlay(ToastOverlay);
    const item = useStackItem(id);
    return (
      <li
        ref={item.ref}
        data-height={height}
        data-index={item.index}
        data-offset={item.offset}
        data-paused={item.paused}
        aria-label={text}
      >
        <button onClick={dismiss}>close {text}</button>
        <button onClick={exited}>exited {text}</button>
      </li>
    );
  }
  const ToastOverlay = overlays.createOverlay("toast", Toast, { exitTransition, exitTimeout: Infinity });
  return { overlays, ToastOverlay, observed, resize, disconnected: () => disconnected };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useStack", () => {
  test("toasts get their index and measured offsets; the group gets count and front height", () => {
    const { overlays, ToastOverlay, observed } = setup();
    render(<overlays.Outlet />);
    act(() => {
      ToastOverlay.open({ text: "first", height: 40 });
      ToastOverlay.open({ text: "second", height: 60 });
    });
    const first = screen.getByLabelText("first");
    const second = screen.getByLabelText("second");
    expect(second).toHaveAttribute("data-index", "0");
    expect(first).toHaveAttribute("data-index", "1");
    expect(first).toHaveAttribute("data-offset", "60");
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-count", "2");
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-front", "60");
    expect(observed.elements()).toEqual(new Set([first, second]));
  });

  test("a resize updates the offsets behind it", () => {
    const { overlays, ToastOverlay, resize } = setup();
    render(<overlays.Outlet />);
    act(() => {
      ToastOverlay.open({ text: "first", height: 40 });
      ToastOverlay.open({ text: "second", height: 60 });
    });
    resize(screen.getByLabelText("second"), 90);
    expect(screen.getByLabelText("first")).toHaveAttribute("data-offset", "90");
  });

  test("hovering the group expands and pauses the toasts", async () => {
    const user = userEvent.setup();
    const { overlays, ToastOverlay } = setup();
    render(<overlays.Outlet />);
    act(() => void ToastOverlay.open({ text: "only", height: 40 }));
    const group = screen.getByLabelText("toasts");

    await user.hover(group);
    expect(group).toHaveAttribute("data-expanded", "true");
    expect(screen.getByLabelText("only")).toHaveAttribute("data-paused", "true");

    await user.unhover(group);
    expect(group).toHaveAttribute("data-expanded", "false");
    expect(screen.getByLabelText("only")).toHaveAttribute("data-paused", "false");
  });

  test("focus moving inside the group keeps it expanded; leaving collapses it", () => {
    const { overlays, ToastOverlay } = setup();
    render(<overlays.Outlet />);
    act(() => {
      ToastOverlay.open({ text: "a", height: 10 });
      ToastOverlay.open({ text: "b", height: 10 });
    });
    const group = screen.getByLabelText("toasts");
    const [a, b] = [screen.getByText("close a"), screen.getByText("close b")];
    fireEvent.focus(a);
    expect(group).toHaveAttribute("data-expanded", "true");
    fireEvent.blur(a, { relatedTarget: b });
    expect(group).toHaveAttribute("data-expanded", "true");
    fireEvent.blur(b, { relatedTarget: null });
    expect(group).toHaveAttribute("data-expanded", "false");
  });

  test("hovering an empty group sticks, so a toast opened under the cursor starts paused", () => {
    const { overlays, ToastOverlay } = setup();
    render(<overlays.Outlet />);
    fireEvent.pointerEnter(screen.getByLabelText("toasts"));
    act(() => void ToastOverlay.open({ text: "new", height: 10 }));
    expect(screen.getByLabelText("new")).toHaveAttribute("data-paused", "true");
  });

  test("the group collapses when its last toast goes", () => {
    const { overlays, ToastOverlay } = setup();
    render(<overlays.Outlet />);
    let instance!: ReturnType<typeof ToastOverlay.open>;
    act(() => void (instance = ToastOverlay.open({ text: "only", height: 10 })));
    fireEvent.pointerEnter(screen.getByLabelText("toasts"));
    act(() => instance.dismiss());
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-expanded", "false");
  });

  test("a hidden page pauses the toasts", () => {
    const { overlays, ToastOverlay } = setup();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    render(<overlays.Outlet />);
    act(() => void ToastOverlay.open({ text: "only", height: 10 }));
    visibility = "hidden";
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByLabelText("only")).toHaveAttribute("data-paused", "true");
  });

  test("a closing toast keeps its position; the others close the gap", async () => {
    const user = userEvent.setup();
    const { overlays, ToastOverlay } = setup({ exitTransition: true });
    render(<overlays.Outlet />);
    act(() => {
      ToastOverlay.open({ text: "old", height: 40 });
      ToastOverlay.open({ text: "new", height: 60 });
    });
    await user.click(screen.getByText("close new"));
    expect(screen.getByLabelText("new")).toHaveAttribute("data-index", "0");
    expect(screen.getByLabelText("new")).toHaveAttribute("data-offset", "0");
    expect(screen.getByLabelText("old")).toHaveAttribute("data-index", "0");
    expect(screen.getByLabelText("old")).toHaveAttribute("data-offset", "0");
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-count", "1");
  });

  test("removing a toast unobserves it; unmounting disconnects", () => {
    const { overlays, ToastOverlay, observed, disconnected } = setup();
    const { unmount } = render(<overlays.Outlet />);
    let instance!: ReturnType<typeof ToastOverlay.open>;
    act(() => void (instance = ToastOverlay.open({ text: "gone", height: 40 })));
    expect(observed.size).toBe(1);
    act(() => instance.dismiss());
    expect(observed.size).toBe(0);
    unmount();
    expect(disconnected()).toBe(1);
  });

  test("two Outlets keep separate hover state, and unmounting one leaves the other measuring", () => {
    const { overlays, ToastOverlay, observed } = setup();
    const first = render(<overlays.Outlet />);
    render(<overlays.Outlet />);
    act(() => void ToastOverlay.open({ text: "t", height: 10 }));
    const [groupA, groupB] = screen.getAllByLabelText("toasts");
    fireEvent.pointerEnter(groupA!);
    expect(groupA).toHaveAttribute("data-expanded", "true");
    expect(groupB).toHaveAttribute("data-expanded", "false");
    first.unmount();
    expect([...observed.elements()]).toEqual([screen.getByLabelText("t")]);
  });
});

describe("misuse", () => {
  test("useStackItem outside a StackProvider throws a hint", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const overlays = createOverlayManager({ layers: { toast: {} } });
    function Toast() {
      useStackItem(useOverlay(ToastOverlay).id);
      return null;
    }
    const ToastOverlay = overlays.createOverlay("toast", Toast);
    render(<overlays.Outlet />);
    expect(() => act(() => void ToastOverlay.open())).toThrow(/StackProvider/);
  });
});

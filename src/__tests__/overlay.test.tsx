import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createOverlayManager, useOverlay } from "../index.ts";

function setup() {
  const overlays = createOverlayManager({ layers: { modal: {}, toast: { limit: 1 } } });

  function NameModal({ title }: { title: string }) {
    const { state, submit, dismiss, exited } = useOverlay(NameOverlay);
    const [name, setName] = useState("");
    const busy = state.phase === "pending";
    return (
      <div role="dialog" aria-label={title} data-phase={state.phase}>
        <input aria-label="name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        {state.phase === "failed" && <p role="alert">{String(state.error)}</p>}
        <button disabled={busy} onClick={() => submit(name)}>
          Save
        </button>
        <button onClick={dismiss}>Cancel</button>
        <button onClick={exited}>Animation done</button>
      </div>
    );
  }
  const NameOverlay = overlays.createOverlay<{ title: string }, string>("modal", NameModal);

  function AnimatedModal() {
    const { state, dismiss, exited } = useOverlay(AnimatedOverlay);
    return (
      <div role="dialog" data-phase={state.phase}>
        <button onClick={dismiss}>Cancel</button>
        <button onClick={exited}>Animation done</button>
      </div>
    );
  }
  const AnimatedOverlay = overlays.createOverlay("modal", AnimatedModal, { exitTransition: true });

  render(<overlays.Outlet />);
  return { overlays, NameOverlay, AnimatedOverlay };
}

describe("form overlay", () => {
  test("stays open and keeps input on failure, then retries", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    const onSubmit = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server down"))
      .mockResolvedValueOnce(undefined);
    act(() => void NameOverlay.open({ title: "Rename" }, { onSubmit }));

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "failed");
    expect(screen.getByLabelText("name")).toHaveValue("Ada");
    expect(screen.getByLabelText("name")).toBeEnabled();

    await user.type(screen.getByLabelText("name"), "!");
    await user.click(screen.getByText("Save"));
    expect(onSubmit).toHaveBeenLastCalledWith("Ada!", expect.anything());
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("is disabled while pending", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    act(() => void NameOverlay.open({ title: "Rename" }, { onSubmit: () => new Promise(() => {}) }));

    await user.click(screen.getByText("Save"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "pending");
    expect(screen.getByLabelText("name")).toBeDisabled();
    await user.click(screen.getByText("Cancel")); // not abortable: ignored
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("update() changes props without remounting", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let instance!: ReturnType<typeof NameOverlay.open>;
    act(() => void (instance = NameOverlay.open({ title: "One" }, { onSubmit: () => {} })));
    await user.type(screen.getByLabelText("name"), "kept");

    act(() => instance.update({ title: "Two" }));
    expect(screen.getByRole("dialog", { name: "Two" })).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toHaveValue("kept");
  });

  test("exitTransition keeps the overlay mounted until exited()", async () => {
    const user = userEvent.setup();
    const { AnimatedOverlay } = setup();
    const onDismiss = vi.fn();
    act(() => void AnimatedOverlay.open({}, { onDismiss }));

    await user.click(screen.getByText("Cancel"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "closing");
    expect(onDismiss).toHaveBeenCalledOnce();
    await user.click(screen.getByText("Animation done"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("openAsync", () => {
  test("resolves with the value and what onSubmit returned, keeping the overlay open through a failure", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    const onSubmit = vi
      .fn<(name: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("Server down"))
      .mockResolvedValueOnce("saved:Ada");
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" }, { onSubmit })));
    const settled = vi.fn();
    void result.then(settled);

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(settled).not.toHaveBeenCalled();

    await user.click(screen.getByText("Save"));
    await expect(result).resolves.toEqual({ submitted: true, value: "Ada", result: "saved:Ada" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("result is undefined when there is no onSubmit", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" })));

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));
    await expect(result).resolves.toEqual({ submitted: true, value: "Ada", result: undefined });
  });

  test("resolves with submitted: false on dismiss, including an aborted submit", async () => {
    const user = userEvent.setup();
    const { NameOverlay, overlays } = setup();
    let first!: Promise<unknown>;
    act(() => void (first = NameOverlay.openAsync({ title: "First" })));
    act(() => overlays.dismissAll());
    await expect(first).resolves.toEqual({ submitted: false });

    let signal!: AbortSignal;
    let second!: Promise<unknown>;
    act(
      () =>
        void (second = NameOverlay.openAsync(
          { title: "Second" },
          { abortable: true, onSubmit: (_, context) => ((signal = context.signal), new Promise(() => {})) },
        )),
    );
    await user.click(screen.getByText("Save"));
    await user.click(screen.getByText("Cancel"));
    await expect(second).resolves.toEqual({ submitted: false });
    expect(signal.aborted).toBe(true);
  });

  test("resolves after the overlay has closed", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" })));
    const dialogAtResolve = result.then(() => screen.queryByRole("dialog"));

    await user.click(screen.getByText("Save"));
    expect(await dialogAtResolve).toBeNull();
  });
});

describe("rendering", () => {
  test("renders layers in declaration order inside their container", () => {
    const Viewport = ({ children }: { children?: React.ReactNode }) => <section aria-label="toasts">{children}</section>;
    const overlays = createOverlayManager({ layers: { modal: {}, toast: { container: Viewport } } });
    const Toast = overlays.createOverlay("toast", ({ text }: { text: string }) => <p>{text}</p>);
    const Modal = overlays.createOverlay("modal", ({ text }: { text: string }) => <p>{text}</p>);
    const { container } = render(<overlays.Outlet />);

    act(() => {
      Toast.open({ text: "toast" });
      Modal.open({ text: "modal" });
    });
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["modal", "toast"]);
    expect(screen.getByLabelText("toasts")).toHaveTextContent("toast");
  });

  test("only the changed overlay re-renders", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const renders: string[] = [];
    function Item({ name }: { name: string }) {
      renders.push(name);
      return null;
    }
    const Overlay = overlays.createOverlay("modal", Item);
    render(<overlays.Outlet />);
    let b!: ReturnType<typeof Overlay.open>;
    act(() => {
      Overlay.open({ name: "a" });
      b = Overlay.open({ name: "b" });
    });
    renders.length = 0;
    act(() => b.update({ name: "b2" }));
    expect(renders).toEqual(["b2"]);
  });
});

describe("useOverlay guard", () => {
  test("throws outside any overlay", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const Handle = overlays.createOverlay("modal", function Named() {
      return null;
    });
    function Outside() {
      useOverlay(Handle);
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow("useOverlay(Named) must be called inside the Named overlay component");
  });

  test("throws inside a different overlay", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const Other = overlays.createOverlay("modal", function OtherOverlay() {
      return null;
    });
    function Wrong() {
      useOverlay(Other);
      return null;
    }
    const WrongHandle = overlays.createOverlay("modal", Wrong);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<overlays.Outlet />);
    expect(() => act(() => void WrongHandle.open())).toThrow(/called inside a different overlay \(Wrong\)/);
  });

  test("the displayName option names the overlay in errors", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const Handle = overlays.createOverlay("modal", () => null, { displayName: "ConfirmDialog" });
    function Outside() {
      useOverlay(Handle);
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow(
      "useOverlay(ConfirmDialog) must be called inside the ConfirmDialog overlay component",
    );
  });
});

describe("observing overlays", () => {
  test("getOverlays and useOverlays reflect open overlays and their phases", async () => {
    const user = userEvent.setup();
    const { overlays, NameOverlay } = setup();
    const seen: string[][] = [];
    function Watcher() {
      seen.push(overlays.useOverlays().map((v) => `${v.layer}:${v.state.phase}`));
      return null;
    }
    render(<Watcher />);
    expect(overlays.getOverlays()).toEqual([]);

    act(() => void NameOverlay.open({ title: "Rename" }, { onSubmit: () => Promise.resolve("ok") }));
    expect(seen.at(-1)).toEqual(["modal:idle"]);
    expect(overlays.getOverlays()[0]).toMatchObject({
      layer: "modal",
      handle: NameOverlay,
      props: { title: "Rename" },
    });

    await user.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));
    expect(overlays.getOverlays()).toEqual([]);
  });
});

describe("reset", () => {
  test("clears the screen and settles openAsync with submitted: false", async () => {
    const { NameOverlay, overlays } = setup();
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" })));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => overlays.reset());
    expect(screen.queryByRole("dialog")).toBeNull();
    await expect(result).resolves.toEqual({ submitted: false });
  });
});

import { describe, expectTypeOf, test } from "vitest";
import {
  createOverlayManager,
  useOverlay,
  type LayerContainerProps,
  type OverlayControl,
  type OverlayHandle,
  type OverlayInstance,
  type OverlayResult,
  type OverlayState,
  type OverlayView,
} from "../index.ts";
import { StackProvider, useStack, useStackItem, type StackItem } from "../stack.ts";

interface User {
  id: string;
  name: string;
}

const overlays = createOverlayManager({
  layers: {
    modal: {},
    menu: { limit: 1, overflow: "dismiss-oldest" },
    toast: { limit: 3 },
  },
});

// The component and its handle reference each other: the spike from the plan.
function UserInfoModal({ user }: { user?: User }) {
  const overlay = useOverlay(UserModal);
  expectTypeOf(overlay).toEqualTypeOf<OverlayControl<User>>();
  return <form onSubmit={() => overlay.submit({ id: "1", name: user?.name ?? "" })} />;
}
const UserModal = overlays.createOverlay<{ user?: User }, User>("modal", UserInfoModal);

function ConfirmDialog({ text }: { text: string }) {
  const { submit } = useOverlay(Confirm);
  return <button onClick={() => submit()}>{text}</button>;
}
const Confirm = overlays.createOverlay<{ text: string }>("modal", ConfirmDialog);

function Toast(_: { message?: string }) {
  return null;
}
const Notice = overlays.createOverlay("toast", Toast);

describe("createOverlay", () => {
  test("only accepts declared layers", () => {
    // @ts-expect-error "drawer" is not a declared layer
    overlays.createOverlay("drawer", Toast);
    overlays.dismissAll("toast");
    // @ts-expect-error not a declared layer
    overlays.dismissAll("drawer");
  });

  test("component props must match the declared props", () => {
    // @ts-expect-error UserInfoModal takes { user?: User }, not { count: number }
    overlays.createOverlay<{ count: number }, User>("modal", UserInfoModal);
  });

  test("props and value are inferred without generics", () => {
    const instance = Notice.open({ message: "hi" });
    expectTypeOf(instance).toEqualTypeOf<OverlayInstance<{ message?: string }>>();
  });
});

describe("open", () => {
  test("a non-void value requires onSubmit", () => {
    UserModal.open({}, { onSubmit: (user) => expectTypeOf(user).toEqualTypeOf<User>() });
    // @ts-expect-error callbacks are required
    UserModal.open({});
    // @ts-expect-error onSubmit is required
    UserModal.open({}, { onDismiss: () => {} });
  });

  test("void overlays make callbacks optional", () => {
    Confirm.open({ text: "Delete?" });
    Confirm.open({ text: "Delete?" }, { abortable: true, onSubmit: (_, { signal }) => fetch("/x", { signal }) });
    // @ts-expect-error text is required
    Confirm.open();
    // @ts-expect-error wrong prop type
    Confirm.open({ text: 1 });
  });

  test("props can be omitted only when all are optional", () => {
    Notice.open();
  });

  test("update replaces the full props", () => {
    const instance = Confirm.open({ text: "a" });
    instance.update({ text: "b" });
    // @ts-expect-error update takes full props, not a partial
    instance.update({});
  });
});

describe("openAsync", () => {
  test("resolves to a result narrowed by submitted", async () => {
    const result = await UserModal.openAsync({});
    expectTypeOf(result).toEqualTypeOf<OverlayResult<User, undefined>>();
    if (result.submitted) expectTypeOf(result.value).toEqualTypeOf<User>();
    // @ts-expect-error value only exists once narrowed to submitted
    void result.value;
    expectTypeOf(Confirm.openAsync({ text: "Delete?" })).toEqualTypeOf<Promise<OverlayResult<void, undefined>>>();
  });

  test("onSubmit is optional even for non-void values, and onDismiss isn't accepted", () => {
    UserModal.openAsync({});
    UserModal.openAsync({}, { abortable: true, onSubmit: (user) => expectTypeOf(user).toEqualTypeOf<User>() });
    // @ts-expect-error the promise replaces onDismiss
    UserModal.openAsync({}, { onDismiss: () => {} });
  });

  test("props follow the same rules as open", () => {
    Notice.openAsync();
    // @ts-expect-error text is required
    Confirm.openAsync();
  });

  test("value is the submitted value; result is what onSubmit returned, awaited", async () => {
    const async = await UserModal.openAsync({}, { onSubmit: (user) => Promise.resolve(user.id) });
    if (async.submitted) {
      expectTypeOf(async.value).toEqualTypeOf<User>();
      expectTypeOf(async.result).toEqualTypeOf<string>();
    }

    const sync = await UserModal.openAsync({}, { onSubmit: (user) => user.name.length });
    if (sync.submitted) expectTypeOf(sync.result).toEqualTypeOf<number>();

    const bare = await UserModal.openAsync({});
    if (bare.submitted) {
      expectTypeOf(bare.value).toEqualTypeOf<User>();
      expectTypeOf(bare.result).toEqualTypeOf<undefined>();
    }
  });
});

describe("useOverlay", () => {
  test("submit takes no argument for void overlays", () => {
    type ConfirmControl = OverlayControl<void>;
    expectTypeOf<ConfirmControl["submit"]>().toEqualTypeOf<() => void>();
    expectTypeOf<OverlayControl<User>["submit"]>().toEqualTypeOf<(value: User) => void>();
  });

  test("error is only readable once the phase is narrowed to failed", () => {
    const state = {} as OverlayState;
    // @ts-expect-error error doesn't exist on every phase
    void state.error;
    if (state.phase === "failed") expectTypeOf(state.error).toBeUnknown();
    if (state.phase === "pending") expectTypeOf(state.abortable).toBeBoolean();
  });
});

describe("stacks", () => {
  function Group({ children, overlays: views }: LayerContainerProps) {
    expectTypeOf(views).toEqualTypeOf<ReadonlyArray<OverlayView>>();
    const stack = useStack(views);
    return (
      <ol {...stack.props}>
        <StackProvider stack={stack}>{children}</StackProvider>
      </ol>
    );
  }
  const stacked = createOverlayManager({ layers: { modal: {}, toast: { container: Group } } });

  function StackToast({ text }: { text: string }) {
    const { id } = useOverlay(StackToastOverlay);
    const item = useStackItem(id);
    expectTypeOf(item).toEqualTypeOf<StackItem>();
    return <li ref={item.ref}>{text}</li>;
  }
  const StackToastOverlay = stacked.createOverlay<{ text: string }, string>("toast", StackToast);

  test("handles in any layer have the same shape", () => {
    expectTypeOf(StackToastOverlay).toEqualTypeOf<OverlayHandle<{ text: string }, string>>();
  });

  test("containers that ignore overlays still fit", () => {
    const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    createOverlayManager({ layers: { modal: { container: Plain } } });
    // @ts-expect-error a container can't require other props
    createOverlayManager({ layers: { modal: { container: (_: { other: number }) => null } } });
  });
});

describe("observing overlays", () => {
  test("views are typed by layer name", () => {
    expectTypeOf(overlays.useOverlays()).toEqualTypeOf<ReadonlyArray<OverlayView<"modal" | "menu" | "toast">>>();
    expectTypeOf(overlays.getOverlays()).toEqualTypeOf<ReadonlyArray<OverlayView<"modal" | "menu" | "toast">>>();
  });
});

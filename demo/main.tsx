import { MoonIcon, SunIcon } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { api, fakeServer, type User } from "./api";
import { ConfirmOverlay } from "./ConfirmDialog";
import { ContextMenuOverlay } from "./ContextMenu";
import { JobPopoverOverlay } from "./JobPopover";
import { overlays } from "./overlays";
import { ToastOverlay } from "./Toast";
import { UserInfoOverlay } from "./UserInfoModal";
import docs, { headings } from "../README.md";
import "./styles.css";

const initialUsers: User[] = [
  { id: "1", name: "Ada Lovelace", job: "Analyst" },
  { id: "2", name: "Alan Turing", job: "Cryptographer" },
];

const toc = [{ depth: 2, id: "demo", text: "Live demo" }, ...headings];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    document.documentElement.classList.toggle("dark", !dark);
    try {
      localStorage.setItem("theme", dark ? "light" : "dark");
    } catch {}
    setDark(!dark);
  };
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle dark mode" onClick={toggle}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function GitHubLink() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="GitHub repository"
      nativeButton={false} render={<a href="https://github.com/scgnkrgll/react-overlord" />}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    </Button>
  );
}

/** Sidebar table of contents. It highlights the section at the top of the viewport. */
function TableOfContents() {
  const [active, setActive] = useState(toc[0]!.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const { id } of toc) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="On this page" className="sticky top-12 max-h-[calc(100vh-6rem)] overflow-auto text-sm">
      <p className="mb-3 font-medium">On this page</p>
      <ul className="grid gap-2">
        {toc.map(({ depth, id, text }) => (
          <li key={id} className={depth === 3 ? "pl-3" : undefined}>
            <a
              href={`#${id}`}
              className={cn(
                "text-muted-foreground transition-colors hover:text-foreground",
                active === id && "font-medium text-foreground",
              )}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Delegated handler for the copy buttons the markdown plugin puts on each code block. */
function copyCode(e: React.MouseEvent) {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy");
  const code = button?.parentElement?.querySelector("pre")?.textContent;
  if (!button || code == null) return;
  void navigator.clipboard.writeText(code).then(() => {
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
}

function App() {
  const [users, setUsers] = useState(initialUsers);
  const [failing, setFailing] = useState(fakeServer.failing);

  // The browser looks for the #hash target before the docs render, so scroll to it once they exist.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const upsert = (saved: User) =>
    setUsers((list) =>
      list.some((u) => u.id === saved.id) ? list.map((u) => (u.id === saved.id ? saved : u)) : [...list, saved],
    );

  const editUser = (user?: User) =>
    UserInfoOverlay.open(user ? { user } : {}, {
      onSubmit: async (draft) => {
        const saved = await api.saveUser(draft); // a rejection keeps the modal open with the error
        upsert(saved);
        ToastOverlay.open({ message: `Saved ${saved.name}`, tone: "success" });
      },
    });

  const deleteUser = (user: User) =>
    ConfirmOverlay.open(
      { title: "Delete user", message: `Delete ${user.name}? The request takes a few seconds, and you can cancel it while it runs.` },
      {
        abortable: true,
        onSubmit: async (_, { signal }) => {
          await api.deleteUser(user.id, signal);
          setUsers((list) => list.filter((u) => u.id !== user.id));
          ToastOverlay.open({ message: `Deleted ${user.name}`, tone: "success" });
        },
        onDismiss: () => ToastOverlay.open({ message: "Delete cancelled" }),
      },
    );

  const editJob = async (anchor: Element, user: User) => {
    const result = await JobPopoverOverlay.openAsync(
      { anchor, job: user.job },
      // `value` is the submitted job title. `result` is what onSubmit returned: the server's record.
      { onSubmit: (job) => api.saveUser({ ...user, job }) },
    );
    if (result.submitted) {
      upsert(result.result);
      ToastOverlay.open({ message: `${result.result.name} is now ${result.value}`, tone: "success" });
    }
  };

  const openMenu = (e: React.MouseEvent, user: User) => {
    e.preventDefault();
    ContextMenuOverlay.open(
      {
        x: e.clientX,
        y: e.clientY,
        items: [
          { action: "edit", label: "Edit…" },
          { action: "delete", label: "Delete…" },
        ],
      },
      { onSubmit: (action) => (action === "edit" ? editUser(user) : deleteUser(user)) },
    );
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:px-8">
      <aside className="hidden lg:block">
        <TableOfContents />
      </aside>

      <main className="min-w-0 max-w-3xl">
        <header className="mb-12">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">react-overlord</h1>
            <div className="flex items-center gap-1">
              <GitHubLink />
              <ThemeToggle />
            </div>
          </div>
          <p className="mt-2 text-muted-foreground">
            Type-safe, headless manager for modals, menus, toasts and other overlays.
          </p>
          <nav className="mt-4 -ml-2.5 flex gap-1">
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="https://github.com/scgnkrgll/react-overlord" />}>
              GitHub
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false} render={<a href="https://www.npmjs.com/package/react-overlord" />}
            >
              npm
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="https://jsr.io/@scgnkrgll/react-overlord" />}>
              JSR
            </Button>
          </nav>
        </header>

        <section>
          <h2 id="demo" className="text-xl font-semibold tracking-tight">
            Live demo
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Right-click a row to open its menu, or click a job to edit it in a popover. Turn on "Server fails" to make
            saves fail. The modal and the popover then stay open with your input and show the error.
          </p>

          <div className="mt-4 mb-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => editUser()}>New user</Button>
            <Button
              variant="outline"
              onClick={() => {
                for (let i = 1; i <= 5; i++) {
                  const message =
                    i === 3
                      ? `Toast #${i} has a longer message, so it is taller than the others in the pile.`
                      : `Toast #${i}`;
                  ToastOverlay.open({ message, tone: i === 5 ? "success" : "info" });
                }
              }}
            >
              Fire 5 toasts
            </Button>
            <Button variant="outline" onClick={() => overlays.dismissAll("toast")}>
              Dismiss toasts
            </Button>
            <Label className="ml-auto">
              <Switch
                checked={failing}
                onCheckedChange={(checked) => {
                  fakeServer.failing = checked;
                  setFailing(checked);
                }}
              />
              Server fails
            </Label>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3">Name</TableHead>
                  <TableHead className="px-3">Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow
                    key={user.id}
                    className="cursor-context-menu"
                    onContextMenu={(e) => openMenu(e, user)}
                    onDoubleClick={() => editUser(user)}
                  >
                    <TableCell className="px-3">{user.name}</TableCell>
                    <TableCell className="px-3">
                      <button
                        type="button"
                        className="-mx-1 rounded px-1 underline decoration-dotted underline-offset-4 hover:bg-accent"
                        onClick={(e) => editJob(e.currentTarget, user)}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {user.job}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section
          className="docs prose prose-neutral mt-16 max-w-none border-t pt-4 dark:prose-invert"
          onClick={copyCode}
          dangerouslySetInnerHTML={{ __html: docs }}
        />

        <overlays.Outlet />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

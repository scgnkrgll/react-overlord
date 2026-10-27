export interface User {
  id: string;
  name: string;
  job: string;
}

/** Lives at module level, so callbacks captured when open() runs always read the current toggle. */
export const fakeServer = { failing: false };

function request<T>(result: T, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (fakeServer.failing) reject(new Error("Server error: please try again."));
      else resolve(result);
    }, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

export const api = {
  saveUser: (user: User) => request(user, 1000),
  deleteUser: (id: string, signal: AbortSignal) => request(id, 2500, signal),
};

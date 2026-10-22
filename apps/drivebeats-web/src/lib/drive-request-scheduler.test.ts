import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import {
  acquireDriveBackgroundLeader,
  createDriveRequestBudget,
  getDriveCoordinationStatus,
  isDriveBackgroundFenceCurrent,
  scheduleDriveRequest,
} from "./drive-request-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function installLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn(
    async (name: string, optionsOrWork: unknown, maybeWork?: unknown) => {
      const options =
        typeof optionsOrWork === "function"
          ? {}
          : (optionsOrWork as { ifAvailable?: boolean; signal?: AbortSignal });
      if (options.ifAvailable && options.signal)
        throw new DOMException(
          "signal cannot be combined with ifAvailable",
          "NotSupportedError",
        );
      const work = (maybeWork ?? optionsOrWork) as (
        lock: { name: string } | null,
      ) => Promise<unknown>;
      if (options.ifAvailable && tails.has(name)) return work(null);
      const previous = tails.get(name) ?? Promise.resolve();
      const result = previous
        .catch(() => {})
        .then(() => {
          options.signal?.throwIfAborted();
          return work({ name });
        });
      tails.set(name, result);
      try {
        return await result;
      } finally {
        if (tails.get(name) === result) tails.delete(name);
      }
    },
  );
  vi.stubGlobal("BroadcastChannel", undefined);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return request;
}
afterEach(async () => {
  useAuthStore.setState({ isLoggingOut: true });
  useAuthStore.setState({ isLoggingOut: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
});

describe("shared Drive transport", () => {
  it.each(["headers", "body"])(
    "bounds protected navigation %s after grant and releases playback",
    async (phase) => {
      vi.useFakeTimers();
      try {
        const navigation = scheduleDriveRequest(
          async (signal) => {
            if (phase === "headers")
              return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
              });
            return new Response(new ReadableStream());
          },
          { accountId: `navigation-deadline-${phase}`, priority: "navigation" },
        )
          .then((response) => response.text())
          .catch((error) => error);
        await vi.advanceTimersByTimeAsync(0);
        const playback = scheduleDriveRequest(
          async () => new Response("audio"),
          { accountId: `navigation-deadline-${phase}`, priority: "playback" },
        ).then((response) => response.text());
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await navigation).toMatchObject({ name: "TimeoutError" });
        expect(await playback).toBe("audio");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("excludes a long queue wait from the navigation deadline and clears it after completion", async () => {
    vi.useFakeTimers();
    try {
      const blocker = await scheduleDriveRequest(
        async () => new Response("audio"),
        { accountId: "navigation-queue-clock", priority: "playback" },
      );
      const request = vi.fn(async () => new Response("folder"));
      let priority: "background" | "navigation" = "background";
      const pending = scheduleDriveRequest(request, {
        accountId: "navigation-queue-clock",
        priority: () => priority,
      }).then((response) => response.text());
      priority = "navigation";
      await vi.advanceTimersByTimeAsync(60_000);
      expect(request).not.toHaveBeenCalled();
      await blocker.text();
      expect(await pending).toBe("folder");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["headers", "body"])(
    "finishes navigation %s before playback, with playback ahead of queued navigation",
    async (phase) => {
      const headers = deferred<void>();
      const body = deferred<void>();
      const order: string[] = [];
      const request = vi.fn(async (signal: AbortSignal) => {
        if (phase === "headers") await headers.promise;
        signal.throwIfAborted();
        return new Response(
          new ReadableStream({
            async start(target) {
              await body.promise;
              target.enqueue(new TextEncoder().encode("folder"));
              target.close();
            },
          }),
        );
      });
      const first = scheduleDriveRequest(request, {
        accountId: "navigation-priority",
        priority: "navigation",
      }).then((response) => response.text());
      const observed = first.catch((error) => error);
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
      const next = scheduleDriveRequest(
        async () => {
          order.push("navigation");
          return new Response("next");
        },
        { accountId: "navigation-priority", priority: "navigation" },
      ).then((response) => response.text());
      const playback = scheduleDriveRequest(
        async () => {
          order.push("playback");
          return new Response("audio");
        },
        { accountId: "navigation-priority", priority: "playback" },
      ).then((response) => response.text());
      headers.resolve();
      body.resolve();
      const result = await observed;
      await Promise.all([next, playback]);
      expect(result).toBe("folder");
      expect(order).toEqual(["playback", "navigation"]);
    },
  );
  it("keeps a second transfer queued until the first delayed body is consumed", async () => {
    const body = deferred<Uint8Array>();
    const first = await scheduleDriveRequest(
      async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(await body.promise);
              controller.close();
            },
          }),
        ),
      { accountId: "delayed", priority: "playback" },
    );
    const next = vi.fn(async () => new Response("second"));
    const second = scheduleDriveRequest(next, { accountId: "delayed" });
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    const text = first.text();
    body.resolve(new TextEncoder().encode("first"));
    expect(await text).toBe("first");
    expect(await (await second).text()).toBe("second");
  });

  it("navigation cancels a full offline body and playback remains protected", async () => {
    const cancelled = vi.fn();
    const first = await scheduleDriveRequest(
      async () => new Response(new ReadableStream({ cancel: cancelled })),
      { accountId: "preemption", priority: "offline" },
    );
    const second = scheduleDriveRequest(async () => new Response("folder"), {
      accountId: "preemption",
      priority: "navigation",
    });
    expect(await (await second).text()).toBe("folder");
    expect(cancelled).toHaveBeenCalledOnce();
    await expect(first.text()).rejects.toMatchObject({
      name: "DrivePreemptedError",
    });

    const playback = await scheduleDriveRequest(
      async () => new Response("audio"),
      { accountId: "protected", priority: "playback" },
    );
    const navigation = vi.fn(async () => new Response("folder"));
    const pending = scheduleDriveRequest(navigation, {
      accountId: "protected",
      priority: "navigation",
    });
    await Promise.resolve();
    expect(navigation).not.toHaveBeenCalled();
    expect(await playback.text()).toBe("audio");
    expect(await (await pending).text()).toBe("folder");
  });

  it("starts a header deadline after queue grant, including waits longer than 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      const blocker = await scheduleDriveRequest(
        async () => new Response("audio"),
        { accountId: "queue-clock", priority: "playback" },
      );
      const granted = vi.fn();
      const request = vi.fn(async () => new Response("offline"));
      const pending = scheduleDriveRequest(request, {
        accountId: "queue-clock",
        priority: "offline",
        headersTimeoutMs: 30_000,
        onGranted: granted,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(granted).not.toHaveBeenCalled();
      expect(await blocker.text()).toBe("audio");
      expect(await (await pending).text()).toBe("offline");
      expect(granted).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reserves every attempt and counts body bytes against an explicit shared batch", async () => {
    const budget = createDriveRequestBudget({ maxRequests: 2, maxBytes: 8 });
    const options = { accountId: "batch", budget, maxBytes: 4 };
    expect(
      await (
        await scheduleDriveRequest(async () => new Response("1234"), options)
      ).text(),
    ).toBe("1234");
    expect(
      await (
        await scheduleDriveRequest(async () => new Response("12"), options)
      ).text(),
    ).toBe("12");
    await expect(
      scheduleDriveRequest(async () => new Response("3"), options),
    ).rejects.toMatchObject({
      reason: "budget_exceeded",
      budgetScope: "consumer",
    });
    expect(budget).toMatchObject({
      requestsUsed: 2,
      bytesRead: 6,
      bytesReserved: 0,
    });
  });

  it("uses the foreground consumer budget when queued background work is promoted", async () => {
    const blocker = await scheduleDriveRequest(
      async () => new Response("audio"),
      { accountId: "promotion", priority: "playback" },
    );
    let foreground = false;
    const budget = createDriveRequestBudget({ maxRequests: 20, maxBytes: 100 });
    const pending = scheduleDriveRequest(async () => new Response("page"), {
      accountId: "promotion",
      priority: () => (foreground ? "navigation" : "background"),
      get budget() {
        return foreground ? budget : undefined;
      },
      maxBytes: 10,
    });
    foreground = true;
    await blocker.text();
    expect(await (await pending).text()).toBe("page");
    expect(budget).toMatchObject({
      requestsUsed: 1,
      bytesRead: 4,
      bytesReserved: 0,
    });
    expect(getDriveCoordinationStatus("promotion").backgroundRequests).toBe(0);
  });

  it("distinguishes a shared automatic window from a consumer's body allowance", async () => {
    installLocks();
    const transport = vi.fn(async () => new Response("body"));
    await expect(
      scheduleDriveRequest(transport, {
        accountId: `window-scope-${crypto.randomUUID()}`,
        priority: "background",
        maxBytes: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({
      reason: "budget_exceeded",
      budgetScope: "background",
      retryAfterMs: expect.any(Number),
    });
    expect(transport).not.toHaveBeenCalled();
    const response = await scheduleDriveRequest(transport, { maxBytes: 1 });
    await expect(response.text()).rejects.toMatchObject({
      reason: "budget_exceeded",
      budgetScope: "consumer",
    });
  });

  it("persists a provider cooldown and automatic budgets, and refuses independent background scans without durable coordination", async () => {
    installLocks();
    const accountId = `durable-${crypto.randomUUID()}`;
    const response = await scheduleDriveRequest(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "600" } }),
      { accountId },
    );
    expect(response.status).toBe(429);
    expect(getDriveCoordinationStatus(accountId).retryAfterMs).toBeGreaterThan(
      590_000,
    );
    vi.resetModules();
    const reloadedScheduler = await import("./drive-request-scheduler");
    const other = vi.fn(async () => new Response("blocked"));
    await expect(
      reloadedScheduler.scheduleDriveRequest(other, { accountId }),
    ).rejects.toMatchObject({ reason: "rate_limited" });
    expect(other).not.toHaveBeenCalled();
    expect(
      localStorage.getItem(`drivebeats-drive-scheduling-v1:${accountId}`),
    ).toContain('"cooldownUntil":');

    const backgroundAccount = `background-${crypto.randomUUID()}`;
    expect(
      await (
        await scheduleDriveRequest(async () => new Response("abc"), {
          accountId: backgroundAccount,
          priority: "background",
          maxBytes: 10,
        })
      ).text(),
    ).toBe("abc");
    expect(getDriveCoordinationStatus(backgroundAccount)).toMatchObject({
      backgroundRequests: 1,
      backgroundBytes: 3,
    });
    vi.useFakeTimers();
    try {
      const following = scheduleDriveRequest(async () => new Response("next"), {
        accountId: backgroundAccount,
        priority: "background",
        maxBytes: 10,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await (await following).text()).toBe("next");
      expect(
        getDriveCoordinationStatus(backgroundAccount).backgroundRequests,
      ).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    await expect(
      scheduleDriveRequest(other, {
        accountId: "degraded",
        priority: "background",
      }),
    ).rejects.toMatchObject({ reason: "coordination_unavailable" });
    expect(
      await (
        await scheduleDriveRequest(async () => new Response("direct"), {
          accountId: "degraded",
        })
      ).text(),
    ).toBe("direct");
  });

  it("uses browser-compatible nonwaiting leadership and rejects cancellation before its callback starts", async () => {
    const request = installLocks();
    await expect(
      navigator.locks.request(
        "invalid",
        { ifAvailable: true, signal: new AbortController().signal },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ name: "NotSupportedError" });
    const work = vi.fn(async () => undefined);
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      acquireDriveBackgroundLeader(
        "cancelled-leader",
        alreadyAborted.signal,
        work,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const pending = acquireDriveBackgroundLeader(
      "cancelled-leader",
      controller.signal,
      work,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenLastCalledWith(
      "drivebeats:leader:cancelled-leader",
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("propagates cancellation after leadership is granted and releases the lease", async () => {
    installLocks();
    const accountId = `abort-leader-${crypto.randomUUID()}`;
    const controller = new AbortController();
    const started = deferred<void>();
    let receivedSignal: AbortSignal | undefined;
    const pending = acquireDriveBackgroundLeader(
      accountId,
      controller.signal,
      async (_fence, signal) => {
        receivedSignal = signal;
        started.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );
    await started.promise;
    controller.abort(new DOMException("Stopped", "AbortError"));
    await pending;
    expect(receivedSignal?.aborted).toBe(true);
    const successor = vi.fn(async () => "successor");
    await expect(
      acquireDriveBackgroundLeader(
        accountId,
        new AbortController().signal,
        successor,
      ),
    ).resolves.toBe("successor");
    expect(successor).toHaveBeenCalledOnce();
  });

  it.each([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "downloadQuotaExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
    "proxy-marker",
  ])(
    "keeps a %s quota response retryable even for a tiny requested Range",
    async (reason) => {
      installLocks();
      const accountId = `quota-${crypto.randomUUID()}`;
      const headers = new Headers({ "Retry-After": "600" });
      if (reason === "proxy-marker")
        headers.set("X-DriveBeats-Rate-Limited", "true");
      const response = await scheduleDriveRequest(
        async () =>
          new Response(
            reason === "proxy-marker"
              ? "Denied"
              : JSON.stringify({ error: { errors: [{ reason }] } }),
            { status: 403, headers },
          ),
        { accountId, maxBytes: 16 },
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("X-DriveBeats-Rate-Limited")).toBe("true");
      expect(
        getDriveCoordinationStatus(accountId).retryAfterMs,
      ).toBeGreaterThan(590_000);
    },
  );

  it("resets accumulated provider backoff after a successful read", async () => {
    installLocks();
    vi.useFakeTimers();
    try {
      const accountId = `reset-rate-${crypto.randomUUID()}`;
      for (let index = 0; index < 4; index++) {
        await scheduleDriveRequest(
          async () => new Response(null, { status: 429 }),
          { accountId },
        );
        await vi.advanceTimersByTimeAsync(300_000);
      }
      expect(
        await (
          await scheduleDriveRequest(async () => new Response("success"), {
            accountId,
          })
        ).text(),
      ).toBe("success");
      await scheduleDriveRequest(
        async () => new Response(null, { status: 429 }),
        { accountId },
      );
      expect(
        getDriveCoordinationStatus(accountId).retryAfterMs,
      ).toBeLessThanOrEqual(1200);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([429, 503])(
    "keeps metadata authentication %s cooldowns out of direct playback/navigation and persists them across modules",
    async (status) => {
      installLocks();
      const accountId = `metadata-lane-${crypto.randomUUID()}`;
      const options = { accountId, cooldownScope: "metadata" as const };
      const failed = await scheduleDriveRequest(
        async () =>
          new Response(null, {
            status,
            headers: {
              "X-DriveBeats-Cooldown-Scope": "metadata",
              "Retry-After": "600",
            },
          }),
        options,
      );
      expect(failed.status).toBe(status);
      expect(getDriveCoordinationStatus(accountId)).toMatchObject({
        retryAfterMs: 0,
      });
      expect(
        getDriveCoordinationStatus(accountId).metadataRetryAfterMs,
      ).toBeGreaterThan(590_000);
      vi.resetModules();
      const reloaded = await import("./drive-request-scheduler");
      expect(
        await (
          await reloaded.scheduleDriveRequest(
            async () => new Response("audio"),
            { accountId, priority: "playback" },
          )
        ).text(),
      ).toBe("audio");
      expect(
        await (
          await reloaded.scheduleDriveRequest(
            async () => new Response("folders"),
            { accountId, priority: "navigation" },
          )
        ).text(),
      ).toBe("folders");
      const range = vi.fn(async () => new Response("range"));
      await expect(
        reloaded.scheduleDriveRequest(range, options),
      ).rejects.toMatchObject({
        reason: "rate_limited",
        cooldownScope: "metadata",
      });
      expect(range).not.toHaveBeenCalled();
    },
  );

  it("applies genuine Drive quota failures from a metadata Range to every Drive lane", async () => {
    installLocks();
    const accountId = `drive-lane-${crypto.randomUUID()}`;
    await scheduleDriveRequest(
      async () =>
        new Response(null, {
          status: 429,
          headers: {
            "Retry-After": "600",
            "X-DriveBeats-Cooldown-Scope": "drive",
          },
        }),
      { accountId, cooldownScope: "metadata" },
    );
    const direct = vi.fn(async () => new Response("audio"));
    await expect(
      scheduleDriveRequest(direct, { accountId, priority: "playback" }),
    ).rejects.toMatchObject({ reason: "rate_limited", cooldownScope: "drive" });
    expect(direct).not.toHaveBeenCalled();
    expect(getDriveCoordinationStatus(accountId).metadataRetryAfterMs).toBe(0);
  });

  it("keeps escalation counters separate and resets metadata failures only after a successful metadata round trip", async () => {
    installLocks();
    vi.useFakeTimers();
    try {
      const accountId = `scope-reset-${crypto.randomUUID()}`;
      const metadata = { accountId, cooldownScope: "metadata" as const };
      for (let index = 0; index < 4; index++) {
        await scheduleDriveRequest(
          async () =>
            new Response(null, {
              status: 429,
              headers: { "X-DriveBeats-Cooldown-Scope": "metadata" },
            }),
          metadata,
        );
        if (index === 3)
          expect(
            getDriveCoordinationStatus(accountId).metadataRetryAfterMs,
          ).toBeGreaterThanOrEqual(6400);
        await vi.advanceTimersByTimeAsync(300_000);
        await (
          await scheduleDriveRequest(async () => new Response("audio"), {
            accountId,
          })
        ).text();
      }
      await (
        await scheduleDriveRequest(async () => new Response("range"), metadata)
      ).text();
      await scheduleDriveRequest(
        async () =>
          new Response(null, {
            status: 429,
            headers: { "X-DriveBeats-Cooldown-Scope": "metadata" },
          }),
        metadata,
      );
      expect(
        getDriveCoordinationStatus(accountId).metadataRetryAfterMs,
      ).toBeLessThanOrEqual(1200);
      expect(getDriveCoordinationStatus(accountId).retryAfterMs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([429, 503])(
    "treats an unmarked metadata endpoint %s as endpoint-only throttling",
    async (status) => {
      installLocks();
      const accountId = `unmarked-${crypto.randomUUID()}`;
      await scheduleDriveRequest(
        async () =>
          new Response(null, { status, headers: { "Retry-After": "600" } }),
        { accountId, cooldownScope: "metadata" },
      );
      expect(getDriveCoordinationStatus(accountId).retryAfterMs).toBe(0);
      expect(
        getDriveCoordinationStatus(accountId).metadataRetryAfterMs,
      ).toBeGreaterThan(590_000);
      expect(
        await (
          await scheduleDriveRequest(async () => new Response("audio"), {
            accountId,
            priority: "playback",
          })
        ).text(),
      ).toBe("audio");
    },
  );

  it("fences the leader and relinquishes automatic work when hidden", async () => {
    installLocks();
    const accountId = `leader-${crypto.randomUUID()}`;
    let visible = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visible as DocumentVisibilityState,
    );
    let previousFence = 0;
    await acquireDriveBackgroundLeader(
      accountId,
      new AbortController().signal,
      async (fence, signal) => {
        previousFence = fence;
        expect(isDriveBackgroundFenceCurrent(accountId, fence)).toBe(true);
        visible = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        expect(signal.aborted).toBe(true);
        expect(isDriveBackgroundFenceCurrent(accountId, fence)).toBe(false);
      },
    );
    visible = "visible";
    await acquireDriveBackgroundLeader(
      accountId,
      new AbortController().signal,
      async (fence) => {
        expect(fence).toBeGreaterThan(previousFence);
        expect(isDriveBackgroundFenceCurrent(accountId, previousFence)).toBe(
          false,
        );
      },
    );
  });
  it("preserves navigation through a playback announcement from another tab", async () => {
    vi.resetModules();
    const { scheduleDriveRequest: schedule } = await import(
      "./drive-request-scheduler"
    );
    let channel:
      | {
          onmessage?: (event: {
            data: { accountId: string; priority: string };
          }) => void;
        }
      | undefined;
    class FakeChannel {
      onmessage?: (event: {
        data: { accountId: string; priority: string };
      }) => void;
      postMessage() {}
      constructor() {
        channel = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const response = await schedule(async () => new Response("folder"), {
      accountId: "cross-tab-navigation",
      priority: "navigation",
    });
    channel?.onmessage?.({
      data: { accountId: "cross-tab-navigation", priority: "playback" },
    });
    expect(await response.text()).toBe("folder");
    expect(channel).toBeDefined();
  });
});

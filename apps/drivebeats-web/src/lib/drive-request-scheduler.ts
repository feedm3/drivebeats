import { useAuthStore } from "@/stores/auth-store";

export type DriveRequestPriority =
  | "playback"
  | "navigation"
  | "prefetch"
  | "visible"
  | "background"
  | "offline";

export interface DriveRequestBudget {
  maxRequests: number;
  maxBytes: number;
  requestsUsed: number;
  bytesRead: number;
  bytesReserved: number;
}
export function createDriveRequestBudget(limits: {
  maxRequests: number;
  maxBytes: number;
}): DriveRequestBudget {
  return { ...limits, requestsUsed: 0, bytesRead: 0, bytesReserved: 0 };
}
export type DriveCooldownScope = "drive" | "metadata";
export type DriveBudgetScope = "consumer" | "background";

export interface DriveRequestOptions {
  cooldownScope?: DriveCooldownScope;
  accountId?: string;
  priority?: DriveRequestPriority | (() => DriveRequestPriority);
  signal?: AbortSignal;
  maxAttempts?: number;
  maxBytes?: number;
  budget?: DriveRequestBudget;
  onGranted?: () => void;
  headersTimeoutMs?: number;
}
export class DrivePreemptedError extends Error {
  constructor() {
    super("Drive transfer yielded to foreground work");
    this.name = "DrivePreemptedError";
  }
}
export class DriveDeferredError extends Error {
  constructor(
    readonly reason:
      | "busy"
      | "budget_exceeded"
      | "rate_limited"
      | "coordination_unavailable"
      | "paused",
    readonly retryAfterMs = 0,
    readonly cooldownScope?: DriveCooldownScope,
    readonly budgetScope?: DriveBudgetScope,
  ) {
    super(reason);
    this.name = "DriveDeferredError";
  }
}
interface SharedState {
  windowStarted: number;
  requests: number;
  bytes: number;
  nextBackgroundAt: number;
  cooldownUntil: number;
  fence: number;
  rateFailures: number;
  metadataCooldownUntil: number;
  metadataRateFailures: number;
}
const memoryState = new Map<string, SharedState>();
const ranks: Record<DriveRequestPriority, number> = {
  playback: 0,
  navigation: 1,
  prefetch: 2,
  visible: 3,
  background: 4,
  offline: 4,
};
const STATE_PREFIX = "drivebeats-drive-scheduling-v1:";
let storageFailed = false;
const coordinationAvailable = () =>
  typeof window !== "undefined" &&
  Boolean(navigator.locks?.request) &&
  !storageFailed;
const accountFor = (options: DriveRequestOptions) =>
  options.accountId ?? useAuthStore.getState().user?.id ?? "anonymous";
const priorityFor = (options: DriveRequestOptions) =>
  typeof options.priority === "function"
    ? options.priority()
    : (options.priority ?? "navigation");
const automatic = (options: DriveRequestOptions) =>
  ["background", "visible"].includes(priorityFor(options));
function freshState(): SharedState {
  return {
    windowStarted: Date.now(),
    requests: 0,
    bytes: 0,
    nextBackgroundAt: 0,
    cooldownUntil: 0,
    fence: 0,
    rateFailures: 0,
    metadataCooldownUntil: 0,
    metadataRateFailures: 0,
  };
}
function readState(accountId: string): SharedState {
  if (coordinationAvailable()) {
    try {
      const value = localStorage.getItem(STATE_PREFIX + accountId);
      if (value) return { ...freshState(), ...JSON.parse(value) };
    } catch {
      storageFailed = true;
    }
  }
  return memoryState.get(accountId) ?? freshState();
}
async function changeState<T>(
  accountId: string,
  change: (state: SharedState) => T,
): Promise<T> {
  const update = () => {
    const state = readState(accountId);
    const result = change(state);
    memoryState.set(accountId, state);
    if (coordinationAvailable()) {
      try {
        localStorage.setItem(STATE_PREFIX + accountId, JSON.stringify(state));
      } catch {
        storageFailed = true;
      }
    }
    return result;
  };
  if (coordinationAvailable())
    return navigator.locks.request(`drivebeats:state:${accountId}`, update);
  return update();
}
function requestCooldown(state: SharedState, scope?: DriveCooldownScope) {
  if (scope === "metadata" && state.metadataCooldownUntil > state.cooldownUntil)
    return { until: state.metadataCooldownUntil, scope: "metadata" as const };
  return { until: state.cooldownUntil, scope: "drive" as const };
}
export function getDriveCoordinationStatus(accountId: string) {
  const state = readState(accountId);
  return {
    available: coordinationAvailable(),
    cooldownUntil: state.cooldownUntil,
    metadataCooldownUntil: state.metadataCooldownUntil,
    metadataRetryAfterMs: Math.max(0, state.metadataCooldownUntil - Date.now()),
    retryAfterMs: Math.max(0, state.cooldownUntil - Date.now()),
    backgroundRequests: state.requests,
    backgroundBytes: state.bytes,
    backgroundResumeAt: Math.max(
      state.nextBackgroundAt,
      state.windowStarted + 120_000,
    ),
  };
}
export async function acquireDriveBackgroundLeader<T>(
  accountId: string,
  signal: AbortSignal,
  work: (fence: number, signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  signal.throwIfAborted();
  if (!coordinationAvailable())
    throw new DriveDeferredError("coordination_unavailable");
  if (document.visibilityState === "hidden" || navigator.onLine === false)
    throw new DriveDeferredError("paused");
  return navigator.locks.request(
    `drivebeats:leader:${accountId}`,
    // Web Locks forbids combining a signal with a nonwaiting acquisition.
    { ifAvailable: true },
    async (lock) => {
      signal.throwIfAborted();
      if (!lock) return undefined;
      if (document.visibilityState === "hidden" || navigator.onLine === false)
        throw new DriveDeferredError("paused");
      const controller = new AbortController();
      const abort = () =>
        controller.abort(signal.reason ?? new DriveDeferredError("paused"));
      const visibility = () => {
        if (document.visibilityState === "hidden")
          controller.abort(new DriveDeferredError("paused"));
      };
      signal.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("offline", abort);
      const fence = await changeState(accountId, (state) => ++state.fence);
      try {
        controller.signal.throwIfAborted();
        return await work(fence, controller.signal);
      } finally {
        controller.abort();
        signal.removeEventListener("abort", abort);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("offline", abort);
        await changeState(accountId, (state) => {
          if (state.fence === fence) state.fence++;
        });
      }
    },
  );
}
export function isDriveBackgroundFenceCurrent(
  accountId: string,
  fence: number,
) {
  return (
    coordinationAvailable() &&
    readState(accountId).fence === fence &&
    document.visibilityState !== "hidden"
  );
}
interface QueueEntry {
  options: DriveRequestOptions;
  accountId: string;
  controller: AbortController;
  run(): Promise<void>;
  reject(reason: unknown): void;
}
const queue: QueueEntry[] = [];
let active: QueueEntry | undefined;
let channel: BroadcastChannel | undefined;
function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return undefined;
  if (!channel) {
    channel = new BroadcastChannel("drivebeats-drive-scheduling-v1");
    channel.onmessage = (
      event: MessageEvent<{
        accountId: string;
        priority: DriveRequestPriority;
      }>,
    ) => {
      if (active?.accountId === event.data.accountId)
        preempt(active, event.data.priority);
    };
  }
  return channel;
}
function preempt(entry: QueueEntry, incoming: DriveRequestPriority) {
  const current = priorityFor(entry.options);
  if (
    ["playback", "navigation"].includes(incoming) &&
    ["prefetch", "offline", "background", "visible"].includes(current)
  ) {
    entry.controller.abort(new DrivePreemptedError());
  }
}
async function drain() {
  if (active || !queue.length) return;
  queue.sort(
    (a, b) => ranks[priorityFor(a.options)] - ranks[priorityFor(b.options)],
  );
  const entry = queue.shift();
  if (!entry) return;
  active = entry;
  try {
    await entry.run();
  } catch (error) {
    entry.reject(error);
  } finally {
    active = undefined;
    void drain();
  }
}
function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function setDriveProviderCooldown(
  accountId: string,
  delayMs: number,
  applyBackoff = true,
  scope: DriveCooldownScope = "drive",
) {
  await changeState(accountId, (state) => {
    const failuresKey =
      scope === "metadata" ? "metadataRateFailures" : "rateFailures";
    const cooldownKey =
      scope === "metadata" ? "metadataCooldownUntil" : "cooldownUntil";
    state[failuresKey] += 1;
    const backoff = Math.min(
      5 * 60_000,
      1000 * 2 ** Math.min(8, state[failuresKey] - 1),
    );
    const jittered = Math.round(backoff * (0.8 + Math.random() * 0.4));
    state[cooldownKey] = Math.max(
      state[cooldownKey],
      Date.now() + Math.max(delayMs, applyBackoff ? jittered : 0),
    );
  });
}
async function reserve(
  accountId: string,
  options: DriveRequestOptions,
  bytes: number,
) {
  const budget = options.budget;
  if (
    budget &&
    (budget.requestsUsed >= budget.maxRequests ||
      budget.bytesRead + budget.bytesReserved + bytes > budget.maxBytes)
  ) {
    throw new DriveDeferredError("budget_exceeded", 0, undefined, "consumer");
  }
  await changeState(accountId, (state) => {
    const now = Date.now();
    const cooldown = requestCooldown(state, options.cooldownScope);
    if (cooldown.until > now)
      throw new DriveDeferredError(
        "rate_limited",
        cooldown.until - now,
        cooldown.scope,
      );
    if (automatic(options)) {
      if (!coordinationAvailable())
        throw new DriveDeferredError("coordination_unavailable");
      if (document.visibilityState === "hidden" || navigator.onLine === false)
        throw new DriveDeferredError("paused");
      if (now - state.windowStarted >= 120_000) {
        state.windowStarted = now;
        state.requests = 0;
        state.bytes = 0;
      }
      // Small tag ranges should not wait as long as audio transfers. Keep a
      // profile-wide request ceiling and the existing 5MiB byte ceiling.
      if (state.requests >= 120 || state.bytes + bytes > 5 * 1024 * 1024)
        throw new DriveDeferredError(
          "budget_exceeded",
          Math.max(1, state.windowStarted + 120_000 - now),
          undefined,
          "background",
        );
      if (state.nextBackgroundAt > now)
        throw new DriveDeferredError("paused", state.nextBackgroundAt - now);
      state.requests++;
      state.bytes += bytes;
      state.nextBackgroundAt = now + 250;
    }
  });
  if (budget) {
    budget.requestsUsed++;
    budget.bytesReserved += bytes;
  }
}

/** A Response owns transport until its body is consumed/cancelled. Every retry requeues. */
export function scheduleDriveRequest(
  request: (signal: AbortSignal) => Promise<Response>,
  options: DriveRequestOptions = {},
): Promise<Response> {
  const accountId = accountFor(options);
  options.signal?.throwIfAborted();
  if (queue.length >= 100)
    return Promise.reject(new DriveDeferredError("busy"));
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let reservedBytes = 0;
  let automaticReservation = false;
  let requestBudget: DriveRequestBudget | undefined;
  let bytesRead = 0;
  let reserved = false;
  let settled = false;
  let navigationTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = async () => {
    if (settled) return;
    settled = true;
    clearTimeout(navigationTimer);
    options.signal?.removeEventListener("abort", abort);
    if (reserved) {
      if (requestBudget) {
        requestBudget.bytesReserved -= reservedBytes;
        requestBudget.bytesRead += bytesRead;
      }
      if (automaticReservation)
        await changeState(accountId, (state) => {
          state.bytes = Math.max(0, state.bytes - reservedBytes + bytesRead);
        });
    }
    complete();
  };
  return new Promise<Response>((resolve, reject) => {
    const entry: QueueEntry = {
      options,
      accountId,
      controller,
      reject,
      async run() {
        const transfer = async () => {
          controller.signal.throwIfAborted();
          const cooldown = requestCooldown(
            readState(accountId),
            options.cooldownScope,
          );
          const retryAfterMs = Math.max(0, cooldown.until - Date.now());
          if (retryAfterMs > 1000)
            throw new DriveDeferredError(
              "rate_limited",
              retryAfterMs,
              cooldown.scope,
            );
          if (retryAfterMs) await wait(retryAfterMs, controller.signal);
          if (automatic(options)) {
            const pacing = readState(accountId).nextBackgroundAt - Date.now();
            if (pacing > 1000) throw new DriveDeferredError("paused", pacing);
            if (pacing > 0) await wait(pacing, controller.signal);
          }
          requestBudget = options.budget;
          automaticReservation = automatic(options);
          reservedBytes =
            options.maxBytes ??
            (automaticReservation || requestBudget
              ? Math.min(
                  1024 * 1024,
                  requestBudget
                    ? requestBudget.maxBytes -
                        requestBudget.bytesRead -
                        requestBudget.bytesReserved
                    : 1024 * 1024,
                )
              : 0);
          await reserve(
            accountId,
            {
              ...options,
              priority: priorityFor(options),
              budget: requestBudget,
            },
            reservedBytes,
          );
          reserved = true;
          controller.signal.throwIfAborted();
          options.onGranted?.();
          // Foreground navigation is allowed to finish when playback arrives,
          // but cannot retain the shared transfer forever. Queue time is free.
          if (priorityFor(options) === "navigation")
            navigationTimer = setTimeout(
              () =>
                controller.abort(
                  new DOMException(
                    "Drive navigation timed out",
                    "TimeoutError",
                  ),
                ),
              30_000,
            );
          let headerTimer: ReturnType<typeof setTimeout> | undefined;
          if (options.headersTimeoutMs)
            headerTimer = setTimeout(
              () =>
                controller.abort(
                  new DOMException(
                    "Drive response headers timed out",
                    "TimeoutError",
                  ),
                ),
              options.headersTimeoutMs,
            );
          let response: Response;
          try {
            response = await request(controller.signal);
          } finally {
            clearTimeout(headerTimer);
          }
          if (response.ok)
            await changeState(accountId, (state) => {
              state.rateFailures = 0;
              if (options.cooldownScope === "metadata")
                state.metadataRateFailures = 0;
            });
          // An endpoint/gateway error must not pause independent Drive reads.
          // The metadata proxy explicitly marks failures received from Drive.
          const responseScope: DriveCooldownScope =
            options.cooldownScope === "metadata" &&
            response.headers.get("X-DriveBeats-Cooldown-Scope") !== "drive"
              ? "metadata"
              : "drive";
          if (
            response.status === 429 ||
            (response.headers.has("Retry-After") &&
              [500, 502, 503, 504].includes(response.status))
          ) {
            const retry = response.headers.get("Retry-After");
            const seconds = Number(retry);
            const delay = retry
              ? Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retry) - Date.now()
              : 1000;
            await setDriveProviderCooldown(
              accountId,
              Math.max(1000, Number.isFinite(delay) ? delay : 1000),
              !retry,
              responseScope,
            );
          }
          if (!response.ok || !response.body) {
            // Callers inspect error status/headers; consume only bounded error JSON for 403 classification.
            if (response.status === 403) {
              const errorReader = response.body?.getReader();
              const parts: Uint8Array[] = [];
              const errorLimit = 16 * 1024;
              if (errorReader) {
                const abortErrorBody = () => {
                  void errorReader.cancel(controller.signal.reason);
                };
                controller.signal.addEventListener("abort", abortErrorBody, {
                  once: true,
                });
                try {
                  for (;;) {
                    controller.signal.throwIfAborted();
                    const chunk = await errorReader.read();
                    if (chunk.done) break;
                    bytesRead += chunk.value.byteLength;
                    if (bytesRead > errorLimit) {
                      await errorReader.cancel();
                      break;
                    }
                    parts.push(chunk.value);
                  }
                  controller.signal.throwIfAborted();
                } finally {
                  controller.signal.removeEventListener(
                    "abort",
                    abortErrorBody,
                  );
                }
              }
              const errorBytes = new Uint8Array(
                parts.reduce((sum, part) => sum + part.byteLength, 0),
              );
              let offset = 0;
              for (const part of parts) {
                errorBytes.set(part, offset);
                offset += part.byteLength;
              }
              const reasonText = new TextDecoder().decode(errorBytes);
              const headers = new Headers(response.headers);
              if (
                response.headers.get("X-DriveBeats-Rate-Limited") === "true" ||
                /userRateLimitExceeded|rateLimitExceeded|downloadQuotaExceeded|dailyLimitExceeded|quotaExceeded/.test(
                  reasonText,
                )
              ) {
                const retry = response.headers.get("Retry-After");
                const seconds = Number(retry);
                const delay = retry
                  ? Number.isFinite(seconds)
                    ? seconds * 1000
                    : Date.parse(retry) - Date.now()
                  : 1000;
                await setDriveProviderCooldown(
                  accountId,
                  Math.max(1000, Number.isFinite(delay) ? delay : 1000),
                  !retry,
                  responseScope,
                );
                headers.set("X-DriveBeats-Rate-Limited", "true");
              }
              resolve(
                new Response(reasonText, {
                  status: response.status,
                  statusText: response.statusText,
                  headers,
                }),
              );
            } else {
              await response.body?.cancel();
              resolve(response);
            }
            await finish();
            return;
          }
          const reader = response.body.getReader();
          const onAbort = () => {
            void reader.cancel(controller.signal.reason).finally(finish);
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          const stream = new ReadableStream<Uint8Array>(
            {
              async pull(target) {
                try {
                  controller.signal.throwIfAborted();
                  const { done, value } = await reader.read();
                  controller.signal.throwIfAborted();
                  if (done) {
                    controller.signal.removeEventListener("abort", onAbort);
                    await finish();
                    target.close();
                    return;
                  }
                  bytesRead += value.byteLength;
                  if (
                    (options.maxBytes !== undefined &&
                      bytesRead > options.maxBytes) ||
                    (requestBudget && bytesRead > reservedBytes)
                  ) {
                    await reader.cancel();
                    throw new DriveDeferredError(
                      "budget_exceeded",
                      0,
                      undefined,
                      "consumer",
                    );
                  }
                  target.enqueue(value);
                } catch (error) {
                  target.error(error);
                  controller.signal.removeEventListener("abort", onAbort);
                  await finish();
                }
              },
              async cancel(reason) {
                await reader.cancel(reason);
                controller.signal.removeEventListener("abort", onAbort);
                await finish();
              },
            },
            { highWaterMark: 0 },
          );
          resolve(
            new Response(stream, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
          );
          await completed;
        };
        try {
          if (coordinationAvailable()) {
            await navigator.locks.request(
              `drivebeats:transport:${accountId}`,
              { signal: controller.signal },
              transfer,
            );
          } else await transfer();
        } finally {
          await finish();
        }
      },
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        const index = queue.indexOf(entry);
        if (index >= 0) {
          queue.splice(index, 1);
          reject(controller.signal.reason);
          void finish();
        }
      },
      { once: true },
    );
    const incoming = priorityFor(options);
    if (active?.accountId === accountId) preempt(active, incoming);
    getChannel()?.postMessage({ accountId, priority: incoming });
    queue.push(entry);
    void drain();
  });
}

// Fence transport across logout/account switches without deleting persisted provider state.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.isLoggingOut) {
    for (const entry of [...queue, ...(active ? [active] : [])])
      entry.controller.abort(new DOMException("Account changed", "AbortError"));
  }
});

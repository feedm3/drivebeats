import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const WORKER_PATH = resolve(process.cwd(), "public/sw.js");
const SHELL_CACHE_NAME = "drivebeats-shell-v5";
const IMMUTABLE_ASSET_CACHE_NAME = "drivebeats-assets-v1";
const OFFLINE_MEDIA_TIMEOUT_MS = 15_000;

type WorkerHandler = (event: unknown) => void;
type RequestInput = Request | string;

function requestKey(input: RequestInput) {
  return typeof input === "string" ? input : new URL(input.url).pathname;
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

class RuntimeCache {
  readonly entries = new Map<string, Response>();
  putBarrier: Promise<void> | undefined;

  async match(input: RequestInput) {
    return this.entries.get(requestKey(input))?.clone();
  }

  async put(input: RequestInput, response: Response) {
    await this.putBarrier;
    this.entries.set(requestKey(input), response.clone());
  }

  async addAll(urls: string[]) {
    for (const url of urls) {
      this.entries.set(url, new Response(url));
    }
  }

  async keys() {
    return [...this.entries.keys()].map(
      (key) => new Request(new URL(key, "https://drivebeats.test")),
    );
  }

  async delete(input: RequestInput) {
    return this.entries.delete(requestKey(input));
  }
}

class RuntimeCacheStorage {
  readonly stores = new Map<string, RuntimeCache>();

  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new RuntimeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }
}

class IndexedDbReadController {
  readonly close = vi.fn();
  readonly stores = new Set<string>();
  readonly createObjectStore = vi.fn((name: string) => {
    this.stores.add(name);
  });
  private openRequest:
    | {
        result: unknown;
        error: Error | null;
        onsuccess?: () => void;
        onerror?: () => void;
        onupgradeneeded?: () => void;
      }
    | undefined;
  private readRequest:
    | {
        result: unknown;
        error: Error | null;
        onsuccess?: () => void;
        onerror?: () => void;
      }
    | undefined;
  private transaction:
    | {
        error: Error | null;
        oncomplete?: () => void;
        onabort?: () => void;
        onerror?: () => void;
      }
    | undefined;

  readonly indexedDb = {
    open: () => {
      const request = {
        result: this.createDatabase(),
        error: null,
      };
      this.openRequest = request;
      return request;
    },
  };

  upgrade() {
    this.openRequest?.onupgradeneeded?.();
  }

  completeOpen() {
    this.openRequest?.onsuccess?.();
  }

  failOpen(error = new Error("IndexedDB unavailable")) {
    if (!this.openRequest) {
      throw new Error("The worker has not opened IndexedDB");
    }
    this.openRequest.error = error;
    this.openRequest.onerror?.();
  }

  succeedRead(record: unknown) {
    if (!this.readRequest) {
      throw new Error("The worker has not started an IndexedDB read");
    }
    this.readRequest.result = record;
    this.readRequest.onsuccess?.();
  }

  completeTransaction() {
    this.transaction?.oncomplete?.();
  }

  private createDatabase() {
    return {
      objectStoreNames: {
        contains: (name: string) => this.stores.has(name),
      },
      createObjectStore: this.createObjectStore,
      close: this.close,
      transaction: () => {
        const readRequest = {
          result: undefined,
          error: null,
        };
        const transaction = {
          error: null,
          objectStore: () => ({
            get: () => readRequest,
          }),
        };
        this.readRequest = readRequest;
        this.transaction = transaction;
        return transaction;
      },
    };
  }
}

interface DispatchedFetch {
  response: Promise<Response>;
  lifetimePromises: Promise<unknown>[];
}

function loadWorker({
  caches = new RuntimeCacheStorage(),
  indexedDB = new IndexedDbReadController().indexedDb,
  fetchImpl = async () => new Response("network"),
}: {
  caches?: RuntimeCacheStorage;
  indexedDB?: { open: () => unknown };
  fetchImpl?: (request: Request) => Promise<Response>;
} = {}) {
  const handlers = new Map<string, WorkerHandler>();
  const workerGlobal = {
    addEventListener: (type: string, handler: WorkerHandler) => {
      handlers.set(type, handler);
    },
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://drivebeats.test" },
    skipWaiting: vi.fn(),
  };

  const context = createContext({
    Blob: NodeBlob,
    Headers,
    Request,
    Response,
    URL,
    caches,
    clearTimeout,
    console,
    fetch: fetchImpl,
    indexedDB,
    self: workerGlobal,
    setTimeout,
  });
  runInContext(readFileSync(WORKER_PATH, "utf8"), context, {
    filename: WORKER_PATH,
  });

  return {
    caches,
    createWorkerBlob(text: string, type: string) {
      Object.assign(context, { __blobText: text, __blobType: type });
      const blob = runInContext(
        "new Blob([__blobText], { type: __blobType })",
        context,
      ) as NodeBlob;
      Reflect.deleteProperty(context, "__blobText");
      Reflect.deleteProperty(context, "__blobType");
      return blob;
    },
    dispatchFetch(request: Request): DispatchedFetch {
      const handler = handlers.get("fetch");
      if (!handler) {
        throw new Error("The worker did not register a fetch handler");
      }

      let dispatching = true;
      let response: Promise<Response> | undefined;
      const lifetimePromises: Promise<unknown>[] = [];
      handler({
        request,
        respondWith(value: Promise<Response>) {
          response = Promise.resolve(value);
        },
        waitUntil(value: Promise<unknown>) {
          if (!dispatching) {
            throw new Error("waitUntil was first called after event dispatch");
          }
          lifetimePromises.push(Promise.resolve(value));
        },
      });
      dispatching = false;

      if (!response) {
        throw new Error("The worker did not call respondWith");
      }
      return { response, lifetimePromises };
    },
  };
}

function observeSettlement(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("actual service-worker fetch lifetime", () => {
  it("retains a navigation cache write until it completes", async () => {
    const caches = new RuntimeCacheStorage();
    const put = deferred();
    const shellCache = await caches.open(SHELL_CACHE_NAME);
    shellCache.putBarrier = put.promise;
    const worker = loadWorker({
      caches,
      fetchImpl: async () =>
        new Response("fresh app", {
          headers: { "Content-Type": "text/html" },
        }),
    });

    const request = new Request("https://drivebeats.test/app");
    Object.defineProperty(request, "mode", { value: "navigate" });
    const fetchEvent = worker.dispatchFetch(request);
    const response = await fetchEvent.response;

    expect(await response.text()).toBe("fresh app");
    expect(fetchEvent.lifetimePromises).toHaveLength(1);
    const lifetime = Promise.all(fetchEvent.lifetimePromises);
    const isLifetimeSettled = observeSettlement(lifetime);
    await Promise.resolve();
    expect(isLifetimeSettled()).toBe(false);

    put.resolve();
    await lifetime;
    expect(await (await shellCache.match("/app"))?.text()).toBe("fresh app");
  });

  it("retains mutable static revalidation after returning a cached response", async () => {
    const caches = new RuntimeCacheStorage();
    const shellCache = await caches.open(SHELL_CACHE_NAME);
    await shellCache.put(
      "/theme-init.js",
      new Response("old theme", {
        headers: { "Content-Type": "text/javascript" },
      }),
    );
    const put = deferred();
    shellCache.putBarrier = put.promise;
    const worker = loadWorker({
      caches,
      fetchImpl: async () =>
        new Response("new theme", {
          headers: { "Content-Type": "text/javascript" },
        }),
    });

    const request = new Request("https://drivebeats.test/theme-init.js");
    Object.defineProperty(request, "destination", { value: "script" });
    const fetchEvent = worker.dispatchFetch(request);

    expect(await (await fetchEvent.response).text()).toBe("old theme");
    expect(fetchEvent.lifetimePromises).toHaveLength(1);
    const lifetime = Promise.all(fetchEvent.lifetimePromises);
    const isLifetimeSettled = observeSettlement(lifetime);
    await Promise.resolve();
    expect(isLifetimeSettled()).toBe(false);

    put.resolve();
    await lifetime;
    expect(await (await shellCache.match("/theme-init.js"))?.text()).toBe(
      "new theme",
    );
  });

  it("retains an immutable asset cache write without changing cache-first behavior", async () => {
    const caches = new RuntimeCacheStorage();
    const assetCache = await caches.open(IMMUTABLE_ASSET_CACHE_NAME);
    const put = deferred();
    assetCache.putBarrier = put.promise;
    const fetchImpl = vi.fn(
      async () =>
        new Response("new chunk", {
          headers: { "Content-Type": "text/javascript" },
        }),
    );
    const worker = loadWorker({ caches, fetchImpl });
    const request = new Request(
      "https://drivebeats.test/_next/static/chunks/app-123.js",
    );
    Object.defineProperty(request, "destination", { value: "script" });

    const fetchEvent = worker.dispatchFetch(request);
    expect(await (await fetchEvent.response).text()).toBe("new chunk");
    expect(fetchEvent.lifetimePromises).toHaveLength(1);
    const lifetime = Promise.all(fetchEvent.lifetimePromises);
    const isLifetimeSettled = observeSettlement(lifetime);
    await Promise.resolve();
    expect(isLifetimeSettled()).toBe(false);

    put.resolve();
    await lifetime;
    expect(
      await (await assetCache.match("/_next/static/chunks/app-123.js"))?.text(),
    ).toBe("new chunk");

    const cachedFetch = worker.dispatchFetch(request);
    expect(await (await cachedFetch.response).text()).toBe("new chunk");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("actual service-worker offline media", () => {
  it("creates the complete shared version-1 schema when the worker opens it first", async () => {
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/missing-track"),
    );
    controller.upgrade();
    controller.completeOpen();
    await Promise.resolve();
    controller.succeedRead(undefined);
    controller.completeTransaction();

    expect((await fetchEvent.response).status).toBe(404);
    expect([...controller.stores].sort()).toEqual([
      "offline_collections",
      "offline_tracks",
    ]);
  });

  it("returns 503 when opening IndexedDB never settles", async () => {
    vi.useFakeTimers();
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1"),
    );
    const isResponseSettled = observeSettlement(fetchEvent.response);
    await vi.advanceTimersByTimeAsync(OFFLINE_MEDIA_TIMEOUT_MS);
    expect(isResponseSettled()).toBe(true);

    const response = await fetchEvent.response;
    expect(response.status).toBe(503);
    expect(response.statusText).toBe("Offline Storage Unavailable");
  });

  it("closes a database that opens after its deadline", async () => {
    vi.useFakeTimers();
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1"),
    );
    await vi.advanceTimersByTimeAsync(OFFLINE_MEDIA_TIMEOUT_MS);
    const isResponseSettled = observeSettlement(fetchEvent.response);
    await Promise.resolve();
    expect(isResponseSettled()).toBe(true);

    expect((await fetchEvent.response).status).toBe(503);

    controller.completeOpen();
    expect(controller.close).toHaveBeenCalledOnce();
  });

  it("returns 503 when an IndexedDB read never settles", async () => {
    vi.useFakeTimers();
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1"),
    );
    controller.completeOpen();
    await Promise.resolve();
    const isResponseSettled = observeSettlement(fetchEvent.response);
    await vi.advanceTimersByTimeAsync(OFFLINE_MEDIA_TIMEOUT_MS);
    expect(isResponseSettled()).toBe(true);

    expect((await fetchEvent.response).status).toBe(503);
    expect(controller.close).toHaveBeenCalledOnce();
  });

  it("returns 503 when IndexedDB reports that storage is unavailable", async () => {
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1"),
    );
    controller.failOpen();

    expect((await fetchEvent.response).status).toBe(503);
  });

  it("returns 404 only after a completed read proves the record is missing", async () => {
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });

    const fetchEvent = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/missing-track"),
    );
    controller.completeOpen();
    await Promise.resolve();
    controller.succeedRead(undefined);
    const isResponseSettled = observeSettlement(fetchEvent.response);
    await Promise.resolve();
    expect(isResponseSettled()).toBe(false);

    controller.completeTransaction();
    expect((await fetchEvent.response).status).toBe(404);
  });

  it("preserves full and byte-range responses for completed records", async () => {
    const controller = new IndexedDbReadController();
    const worker = loadWorker({ indexedDB: controller.indexedDb });
    const record = {
      blob: worker.createWorkerBlob("0123456789", "audio/mpeg"),
      mimeType: "audio/mpeg",
    };

    const fullFetch = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1"),
    );
    controller.completeOpen();
    await Promise.resolve();
    controller.succeedRead(record);
    controller.completeTransaction();
    const fullResponse = await fullFetch.response;

    expect(fullResponse.status).toBe(200);
    expect(fullResponse.headers.get("Content-Length")).toBe("10");
    expect(fullResponse.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await fullResponse.text()).toBe("0123456789");

    const rangeFetch = worker.dispatchFetch(
      new Request("https://drivebeats.test/offline-media/track-1", {
        headers: { Range: "bytes=2-5" },
      }),
    );
    controller.completeOpen();
    await Promise.resolve();
    controller.succeedRead(record);
    controller.completeTransaction();
    const rangeResponse = await rangeFetch.response;

    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(rangeResponse.headers.get("Content-Length")).toBe("4");
    expect(rangeResponse.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await rangeResponse.text()).toBe("2345");
  });
});

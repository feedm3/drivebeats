declare module "jsmediatags" {
  interface TagResult {
    tags: Record<string, unknown>;
  }

  interface ReadCallbacks {
    onSuccess: (result: TagResult) => void;
    onError: (error: { type: string; info: string }) => void;
  }

  interface JsMediaTags {
    read: (source: Blob | string, callbacks: ReadCallbacks) => void;
  }

  const jsmediatags: JsMediaTags;
  export default jsmediatags;
}

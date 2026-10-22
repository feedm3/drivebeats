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
    Reader: typeof Reader;
  }

  class Reader {
    constructor(source: unknown);
    setTagsToRead(tags: string[]): this;
    setTagReader(reader: unknown): this;
    setFileReader(reader: new (source: never) => unknown): this;
    read(callbacks: ReadCallbacks): void;
  }

  const jsmediatags: JsMediaTags;
  export default jsmediatags;
}

declare module "jsmediatags/build2/ID3v2TagReader" {
  class ID3v2TagReader {
    protected _loadData(
      reader: import("jsmediatags/build2/MediaFileReader").default,
      callbacks: {
        onSuccess: () => void;
        onError: (error: { type: string; info: string }) => void;
      },
    ): void;
  }
  export default ID3v2TagReader;
}

declare module "jsmediatags/build2/MediaFileReader" {
  interface ReaderCallbacks {
    onSuccess: () => void;
    onError: (error: { type: string; info: string }) => void;
  }
  class MediaFileReader {
    protected _size: number;
    protected _isInitialized: boolean;
    constructor(source?: unknown);
    init(callbacks: ReaderCallbacks): void;
    loadRange(range: [number, number], callbacks: ReaderCallbacks): void;
    getByteAt(offset: number): number;
    getSize(): number;
  }
  export default MediaFileReader;
}

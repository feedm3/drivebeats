export class GoogleDriveReadError extends Error {
  constructor(
    public readonly status: number,
    message = `Google Drive read failed (${status})`,
  ) {
    super(message);
    this.name = "GoogleDriveReadError";
  }
}

export class LibraryIncompleteError extends Error {
  constructor() {
    super("Google Drive returned an incomplete Library Search");
    this.name = "LibraryIncompleteError";
  }
}

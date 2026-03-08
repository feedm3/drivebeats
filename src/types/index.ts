export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface FolderEntry {
  id: string;
  name: string;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export const INITIAL_STACK: FolderEntry[] = [{ id: "root", name: "My Drive" }];

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

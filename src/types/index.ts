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

export interface PlaylistTrack {
  fileId: string;
  fileName: string;
  mimeType?: string;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
}

export const FAVORITES_COLLECTION_ID = "system:favorites";
export const RECENTLY_PLAYED_COLLECTION_ID = "system:recently-played";

export type SmartCollectionId =
  | typeof FAVORITES_COLLECTION_ID
  | typeof RECENTLY_PLAYED_COLLECTION_ID;

export interface SmartCollection {
  id: SmartCollectionId;
  kind: "favorites" | "recently-played";
  name: string;
  tracks: PlaylistTrack[];
}

export type TrackCollection = Playlist | SmartCollection;

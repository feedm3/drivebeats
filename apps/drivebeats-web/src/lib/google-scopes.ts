export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";
function toGrantedScopeSet(scopes: string | string[] | undefined) {
  const values = Array.isArray(scopes)
    ? scopes
    : typeof scopes === "string"
      ? scopes.split(/\s+/)
      : [];

  return new Set(values.filter((scope) => scope.length > 0));
}

export function parseGrantedGoogleScopes(scopes: string | undefined) {
  return [...toGrantedScopeSet(scopes)];
}

export function hasGoogleDriveScope(scopes: string | string[] | undefined) {
  return toGrantedScopeSet(scopes).has(GOOGLE_DRIVE_SCOPE);
}

export function hasGoogleAppDataScope(scopes: string | string[] | undefined) {
  return toGrantedScopeSet(scopes).has(GOOGLE_APPDATA_SCOPE);
}

export function hasRequiredGoogleScopes(scopes: string | string[] | undefined) {
  return hasGoogleDriveScope(scopes) && hasGoogleAppDataScope(scopes);
}

import type { DriveFile } from "@/types";

const WHITESPACE_PATTERN = /\s+/;

export interface HighlightPart {
  isMatch: boolean;
  start: number;
  value: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getSearchTokens(query: string) {
  return [
    ...new Set(query.trim().toLocaleLowerCase().split(WHITESPACE_PATTERN)),
  ].filter(Boolean);
}

export function matchesFileSearch(file: DriveFile, query: string) {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  const fileName = file.name.toLocaleLowerCase();
  return tokens.every((token) => fileName.includes(token));
}

export function filterFilesBySearch(files: DriveFile[], query: string) {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) {
    return files;
  }

  return files.filter((file) => {
    const fileName = file.name.toLocaleLowerCase();
    return tokens.every((token) => fileName.includes(token));
  });
}

export function getHighlightedTextParts(
  text: string,
  query: string,
): HighlightPart[] {
  const tokens = getSearchTokens(query).toSorted((a, b) => b.length - a.length);
  if (tokens.length === 0) {
    return [{ isMatch: false, start: 0, value: text }];
  }

  const expression = new RegExp(
    `(${tokens.map((token) => escapeRegExp(token)).join("|")})`,
    "gi",
  );
  const parts: HighlightPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(expression)) {
    const start = match.index ?? 0;
    const value = match[0];

    if (start > lastIndex) {
      parts.push({
        isMatch: false,
        start: lastIndex,
        value: text.slice(lastIndex, start),
      });
    }

    parts.push({ isMatch: true, start, value });
    lastIndex = start + value.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      isMatch: false,
      start: lastIndex,
      value: text.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ isMatch: false, start: 0, value: text }];
}

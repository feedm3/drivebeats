import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getHistoryStateWithFolderStack(
  folderStack: { id: string; name: string }[],
) {
  return {
    ...(window.history.state ?? {}),
    folderStack,
  };
}

import { Button } from "@/components/ui/button";

interface LibrarySearchErrorProps {
  hasCompleteCatalog: boolean;
  message: string;
  onRetry: () => void;
}

export function LibrarySearchError({
  hasCompleteCatalog,
  message,
  onRetry,
}: LibrarySearchErrorProps) {
  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-700 dark:text-amber-300"
      role="alert"
    >
      <span className="select-text">
        {message}
        {hasCompleteCatalog ? " Showing the last complete results." : ""}
      </span>
      <Button
        variant="link"
        size="xs"
        className="h-11 px-2 text-current underline"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

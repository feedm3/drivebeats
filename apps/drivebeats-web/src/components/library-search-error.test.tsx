import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibrarySearchError } from "@/components/library-search-error";

describe("Library Search error", () => {
  afterEach(cleanup);

  it("keeps the message selectable and the retry hit area inside its own box", () => {
    const onRetry = vi.fn();

    render(
      <LibrarySearchError
        hasCompleteCatalog={false}
        message="Could not refresh the Library."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Could not refresh the Library.")).toHaveClass(
      "select-text",
    );

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveClass("h-11");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

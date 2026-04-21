import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface LandingFaqItemProps {
  question: string;
  children: ReactNode;
}

export function LandingFaqItem({ question, children }: LandingFaqItemProps) {
  return (
    <details className="group rounded-lg border border-border bg-card/50 px-5 py-4 open:bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        <span>{question}</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

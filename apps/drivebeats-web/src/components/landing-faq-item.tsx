import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface LandingFaqItemProps {
  question: string;
  children: ReactNode;
}

export function LandingFaqItem({ question, children }: LandingFaqItemProps) {
  return (
    <details className="group rounded-lg border border-border bg-card/50 px-5 py-4 open:bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        {question}
        <ChevronDown
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3 text-pretty text-base text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

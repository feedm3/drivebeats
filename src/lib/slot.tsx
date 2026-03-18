import * as React from "react";

function Slot({
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const child = React.Children.only(children);
  if (!React.isValidElement(child)) return null;
  return React.cloneElement(child, {
    ...props,
    ...(child.props as Record<string, unknown>),
  });
}

export { Slot };

"use client";

import type { InputHTMLAttributes, Ref } from "react";

export function SearchInput({
  inputRef,
  onValueChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: Ref<HTMLInputElement>;
  onValueChange(value: string): void;
}) {
  return (
    <input
      {...props}
      ref={inputRef}
      type="search"
      inputMode="search"
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

"use client";
import { useEffect } from "react";
import { startMetadataIndex } from "@/lib/metadata-index-coordinator";
export function MetadataIndexProvider() {
  useEffect(() => startMetadataIndex(), []);
  return null;
}

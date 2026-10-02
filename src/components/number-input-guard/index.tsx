"use client";

import { useEffect } from "react";

import { installNumberInputWheelGuard } from "@/lib/number-input-wheel-guard";

// Mounted once in the root layout. The returned cleanup removes the document
// listener, so React StrictMode's double-mount leaves exactly one listener.
export function NumberInputGuard() {
  useEffect(() => installNumberInputWheelGuard(document), []);
  return null;
}

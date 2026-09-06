"use client";

import { useEffect, useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

// Keeps a half-filled consultation alive across an accidental refresh.
//
// A consultant measures a whole flat before saving anything, so a stray reload
// — or a phone reclaiming the tab's memory — costs the entire visit. This
// mirrors the form into sessionStorage on every change and restores it on
// mount.
//
// sessionStorage, not localStorage, is deliberate: the draft belongs to this
// tab and this sitting. It survives a refresh, which is the failure being
// solved, and dies with the tab rather than resurfacing days later on top of an
// order that has since been saved and edited.
//
// This is NOT the "Save as draft" feature. That persists to the database on
// purpose and is visible to the whole team; this is a local crash-recovery net
// that no one else can see.

const PREFIX = "drapeworks:form-draft:";
// Version 2 invalidates drafts written by the old shallow-merge restore. Those
// drafts may already contain a synthetic blank site_address and cannot be
// distinguished from a field the consultant intentionally cleared.
const FORMAT_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

/**
 * Restore fields the draft actually contains while retaining newer nested
 * defaults supplied by the server. Arrays are intentionally replaced as a
 * unit: removing a room or window is itself recoverable draft state.
 */
export function mergeFormDraft<T>(defaults: T, draft: DeepPartial<T>): T {
  function merge(defaultValue: unknown, draftValue: unknown): unknown {
    if (draftValue === undefined) return defaultValue;

    if (isRecord(defaultValue) && isRecord(draftValue)) {
      const result: Record<string, unknown> = { ...defaultValue };
      for (const [field, value] of Object.entries(draftValue)) {
        result[field] = merge(defaultValue[field], value);
      }
      return result;
    }

    return draftValue;
  }

  return merge(defaults, draft) as T;
}

/** Same form, same key, across mounts — create and each edited order differ. */
export function formDraftKey(
  product: "curtain" | "mesh",
  mode: "create" | "edit",
  orderId?: string,
): string {
  return `${PREFIX}v${FORMAT_VERSION}:${product}:${mode}:${orderId ?? "new"}`;
}

export function useFormDraft<T extends FieldValues>(
  form: UseFormReturn<T>,
  key: string,
): { clearDraft: () => void } {
  // Restore runs once. Without this guard the subscription below would see the
  // restore as a change, rewrite storage, and fight the user's next keystroke.
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    try {
      const saved = sessionStorage.getItem(key);
      if (!saved) return;

      // Merge recursively rather than replacing a whole section. A stored
      // draft written before a nested field (such as order.site_address) was
      // added must not wipe the current value supplied by the server.
      const parsed = JSON.parse(saved) as DeepPartial<T>;
      form.reset(mergeFormDraft(form.getValues(), parsed), {
        keepDefaultValues: true,
      });
    } catch {
      // A corrupt or unreadable draft must never block the form. Drop it and
      // carry on with the server-provided defaults.
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* storage unavailable — nothing to clean up */
      }
    }
  }, [form, key]);

  useEffect(() => {
    const sub = form.watch((values) => {
      try {
        sessionStorage.setItem(key, JSON.stringify(values));
      } catch {
        // Private browsing and quota exhaustion both throw here. Losing the
        // safety net is acceptable; breaking the form is not.
      }
    });
    return () => sub.unsubscribe();
  }, [form, key]);

  return {
    clearDraft: () => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* nothing to clean up */
      }
    },
  };
}

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

/** Same form, same key, across mounts — create and each edited order differ. */
export function formDraftKey(
  product: "curtain" | "mesh",
  mode: "create" | "edit",
  orderId?: string,
): string {
  return `${PREFIX}${product}:${mode}:${orderId ?? "new"}`;
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

      // Merge rather than replace: a stored draft written before a field was
      // added would otherwise wipe that field's default to undefined.
      const parsed = JSON.parse(saved) as Partial<T>;
      form.reset({ ...form.getValues(), ...parsed } as T, {
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

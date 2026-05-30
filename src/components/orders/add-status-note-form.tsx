"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addStatusNote } from "@/lib/actions/status";

type Props = {
  orderId: string;
};

export function AddStatusNoteForm({ orderId }: Props) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await addStatusNote({ orderId, note: trimmed });
        toast.success("Note added");
        setNote("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add note");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 pt-4 border-t border-slate-100">
      <label className="block text-xs font-medium text-slate-600 mb-1">
        Add note to current status
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. installation booked for 18 Jun, 9am"
          className="flex-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
        />
        <button
          type="submit"
          disabled={pending || !note.trim()}
          className="px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Adding…" : "Add note"}
        </button>
      </div>
    </form>
  );
}

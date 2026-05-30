"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { inviteUser } from "@/lib/actions/users";

const INPUT_CLS =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"consultant" | "ops" | "admin">("consultant");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !fullName.trim()) {
      toast.error("Email and name required");
      return;
    }
    startTransition(async () => {
      try {
        await inviteUser({ email: email.trim(), fullName: fullName.trim(), role });
        toast.success(`Invite sent to ${email.trim()}`);
        setOpen(false);
        setEmail("");
        setFullName("");
        setRole("consultant");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Invite failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
      >
        + Invite user
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "consultant" | "ops" | "admin")
              }
              className={INPUT_CLS}
            >
              <option value="consultant">Consultant</option>
              <option value="ops">Ops</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
            >
              {pending ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

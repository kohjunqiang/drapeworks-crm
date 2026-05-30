"use client";

import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleBadge } from "./role-badge";
import { signOut } from "@/lib/actions/auth";
import type { SessionData } from "@/lib/auth/get-session";

type Props = {
  profile: SessionData["profile"];
};

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || "??";
}

export function UserMenu({ profile }: Props) {
  const [pending, startTransition] = useTransition();
  const display = profile.full_name?.trim() || profile.email;

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-full"
      >
        <span className="hidden sm:inline text-sm text-slate-500">
          {display}
        </span>
        <span className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
          {initials(profile.full_name, profile.email)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-900">{display}</span>
          <span className="text-xs text-slate-500">{profile.email}</span>
          <span className="mt-1">
            <RoleBadge role={profile.role} />
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            handleSignOut();
          }}
          disabled={pending}
          className="text-red-600 focus:text-red-700"
        >
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

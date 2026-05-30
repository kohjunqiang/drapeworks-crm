import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set password — Drapeworks CRM" };

const MIN_PASSWORD = 8;

async function setPassword(formData: FormData) {
  "use server";
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (!password || password.length < MIN_PASSWORD) {
    redirect(`/set-password?error=length`);
  }
  if (password !== confirm) {
    redirect(`/set-password?error=mismatch`);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/set-password?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/orders");
}

type SearchParams = { error?: string };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  return (
    <form
      action={setPassword}
      className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-6">
        <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">
          D
        </div>
        <span className="font-semibold text-slate-900">Drapeworks CRM</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">
        Set your password
      </h1>
      <p className="text-sm text-slate-500 mb-4">
        Welcome, {user.email}. Choose a password at least {MIN_PASSWORD}{" "}
        characters long.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-xs mb-4">
          {error === "length"
            ? `Password must be at least ${MIN_PASSWORD} characters.`
            : error === "mismatch"
            ? "Passwords do not match."
            : `Update failed: ${error}`}
        </div>
      )}

      <Label htmlFor="password" className="text-xs">
        New password
      </Label>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        required
        className="mt-1 mb-3"
      />

      <Label htmlFor="confirm" className="text-xs">
        Confirm password
      </Label>
      <Input
        id="confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        required
        className="mt-1 mb-4"
      />

      <Button
        type="submit"
        className="w-full bg-teal-600 hover:bg-teal-700 text-white"
      >
        Save password
      </Button>
    </form>
  );
}

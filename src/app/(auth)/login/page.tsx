import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Drapeworks CRM" };

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) {
    redirect("/login?error=missing");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/orders");
}

type SearchParams = { error?: string; reset?: string; inactive?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, reset, inactive } = await searchParams;

  return (
    <form
      action={signIn}
      className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-6">
        <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">
          D
        </div>
        <span className="font-semibold text-slate-900">Drapeworks CRM</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-4">
        Enter your email and password.
      </p>

      {reset === "1" && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded p-3 text-xs mb-4">
          Check your inbox for the password reset link.
        </div>
      )}
      {inactive === "1" && (
        <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded p-3 text-xs mb-4">
          Your account has been deactivated. Contact an admin to restore access.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-xs mb-4">
          {error === "missing"
            ? "Email and password are required."
            : `Sign-in failed: ${error}`}
        </div>
      )}

      <Label htmlFor="email" className="text-xs">
        Email
      </Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        className="mt-1 mb-3"
      />

      <Label htmlFor="password" className="text-xs">
        Password
      </Label>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="mt-1 mb-4"
      />

      <Button
        type="submit"
        className="w-full bg-teal-600 hover:bg-teal-700 text-white"
      >
        Sign in
      </Button>

      <div className="mt-4 text-xs text-center text-slate-500">
        <Link href="/forgot-password" className="hover:text-teal-700">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

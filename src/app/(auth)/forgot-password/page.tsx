import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset password — Drapeworks CRM" };

async function sendReset(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim();
  if (!email) {
    redirect("/forgot-password?error=missing");
  }
  const supabase = await createClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/set-password`,
  });
  if (error) {
    redirect(`/forgot-password?error=${encodeURIComponent(error.message)}`);
  }
  // Always confirm; don't disclose whether the email exists.
  redirect("/login?reset=1");
}

type SearchParams = { error?: string };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error } = await searchParams;
  return (
    <form
      action={sendReset}
      className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-6">
        <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">
          D
        </div>
        <span className="font-semibold text-slate-900">Drapeworks CRM</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">
        Reset password
      </h1>
      <p className="text-sm text-slate-500 mb-4">
        We&apos;ll email you a reset link.
      </p>

      {error === "expired" && (
        <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded p-3 text-xs mb-4">
          Your password reset link has expired. Request a new one below.
        </div>
      )}
      {error && error !== "expired" && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-xs mb-4">
          {error === "missing"
            ? "Please enter your email."
            : `Reset failed: ${error}`}
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
        className="mt-1 mb-4"
      />
      <Button
        type="submit"
        className="w-full bg-teal-600 hover:bg-teal-700 text-white"
      >
        Send reset link
      </Button>

      <div className="mt-4 text-xs text-center text-slate-500">
        <Link href="/login" className="hover:text-teal-700">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}

import type { Metadata } from "next";

// The token lives in the URL, so the page must not be indexed and must not
// leak the URL onward: referrer "no-referrer" keeps it out of the Referer
// header when room photos load from Supabase Storage.
export const metadata: Metadata = {
  title: "Installation details — Drapeworks",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function InstallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

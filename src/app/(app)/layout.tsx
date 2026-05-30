import { TopNav } from "@/components/nav/top-nav";
import { requireSession } from "@/lib/auth/require-role";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return (
    <>
      <TopNav profile={session.profile} />
      {children}
    </>
  );
}

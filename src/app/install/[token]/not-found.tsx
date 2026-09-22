// One neutral answer for every inactive case — unknown token, malformed
// token, cancelled booking, expired link — so the response never reveals
// which one applied.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <p className="text-sm text-slate-700">
          This link is no longer active. Please contact Drapeworks.
        </p>
      </section>
    </main>
  );
}

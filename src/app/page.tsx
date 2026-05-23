export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
            TruePrice
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Compute the true effective cost of an online purchase.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">
            Paste an Amazon or Flipkart URL, inspect the visible offers, and
            calculate the best eligible deal with deterministic pricing logic.
          </p>
        </div>

        <div className="mt-12 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur">
          <div className="space-y-4">
            <div className="h-14 rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-400">
              https://www.amazon.in/dp/B0...
            </div>
            <button className="inline-flex h-12 items-center justify-center rounded-2xl bg-cyan-400 px-5 font-medium text-slate-950 transition hover:bg-cyan-300">
              Analyze Deal
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

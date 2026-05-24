"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";

type UserContext = {
  paymentMethod?: "credit_card" | "debit_card" | "upi" | "emi" | "wallet";
  bankName?: string;
  cardName?: string;
};

type AnalysisResponse = {
  platform: "flipkart";
  product: {
    title: string;
    productPrice: number;
    mrp: number | null;
    deliveryFee: number | null;
    currency: "INR";
    sku?: string | null;
  };
  offers: Array<{
    id: string;
    type: string;
    title: string;
    bank: string | null;
    discountType: string | null;
    discountValue: number | null;
    maxDiscount: number | null;
    requiresEmi: boolean;
    emiMonths: number[] | null;
    minPurchaseAmount: number | null;
    isInstant: boolean;
    isStackable: boolean;
    rawText: string;
  }>;
  eligibility: Array<{
    offerId: string;
    isEligible: boolean;
    reason?: string | null;
  }>;
  pricingAnalysis: {
    eligibility: Array<{
      offerId: string;
      isEligible: boolean;
      reason?: string | null;
    }>;
    verdict: {
      score: number;
      label: string;
      shortText: string;
    };
    pricing: {
      basePrice: number;
      deliveryFee: number;
      instantDiscount: number;
      couponDiscount: number;
      bankDiscount: number;
      cashbackValue: number;
      emiExtraCost: number;
      finalPayableNow: number;
      delayedBenefit: number;
      effectiveCost: number;
    };
    explanation: string;
    bestOfferIds: string[];
  };
};

const SAMPLE_URL = "https://www.flipkart.com/p/itm-example";

const PAYMENT_METHODS: Array<{ value: UserContext["paymentMethod"] | undefined; label: string }> = [
  { value: undefined, label: "Any payment method" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "upi", label: "UPI" },
  { value: "emi", label: "EMI" },
  { value: "wallet", label: "Wallet" },
];

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<UserContext["paymentMethod"]>();
  const [bankName, setBankName] = useState("");
  const [cardName, setCardName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          userContext: {
            paymentMethod,
            bankName: bankName || undefined,
            cardName: cardName || undefined,
          },
        }),
      });

      const data = (await response.json()) as AnalysisResponse & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error || data.message || "Unable to analyze this product right now.");
      }

      setResult(data);
    } catch (submitError) {
      setResult(null);
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setUrl(SAMPLE_URL);
    setPaymentMethod("credit_card");
    setBankName("HDFC");
    setCardName("HDFC Millennia");
  }

  const pricing = result?.pricingAnalysis.pricing;
  const eligibleOfferIds = useMemo(
    () => new Set((result?.pricingAnalysis.eligibility ?? []).filter((offer) => offer.isEligible).map((offer) => offer.offerId)),
    [result]
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:flex-row lg:items-start lg:py-16">
        <section className="flex-1 rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur md:p-8">
          <div className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.28em] text-cyan-200">
            TruePrice
          </div>
          <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Find the real Flipkart price, not just the sticker price.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            Paste a Flipkart product URL, add your payment details, and the app will calculate the best eligible offer stack with deterministic pricing logic.
          </p>

          <form onSubmit={handleSubmit} className="mt-10 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Flipkart URL</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.flipkart.com/..."
                className="h-14 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Payment method</span>
                <select
                  value={paymentMethod ?? ""}
                  onChange={(event) => setPaymentMethod((event.target.value || undefined) as UserContext["paymentMethod"])}
                  className="h-14 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 text-slate-100 outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.label} value={method.value ?? ""}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Bank name</span>
                <input
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                  placeholder="HDFC, SBI, ICICI..."
                  className="h-14 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-200">Card name</span>
                <input
                  value={cardName}
                  onChange={(event) => setCardName(event.target.value)}
                  placeholder="Optional"
                  className="h-14 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-cyan-400 px-5 font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Analyzing..." : "Analyze deal"}
              </button>
              <button
                type="button"
                onClick={loadSample}
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 font-medium text-slate-100 transition hover:bg-white/10"
              >
                Load sample
              </button>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </form>
        </section>

        <aside className="w-full space-y-4 lg:max-w-xl">
          <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/20 backdrop-blur">
            <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">Result</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              {result ? result.pricingAnalysis.verdict.label : "Waiting for a product URL"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {result ? result.pricingAnalysis.explanation : "Submit a Flipkart URL to inspect the extracted price, offers, and effective cost."}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <StatCard label="Base price" value={formatCurrency(pricing?.basePrice)} />
              <StatCard label="Payable now" value={formatCurrency(pricing?.finalPayableNow)} />
              <StatCard label="Effective cost" value={formatCurrency(pricing?.effectiveCost)} />
              <StatCard label="Best offers" value={result ? String(result.pricingAnalysis.bestOfferIds.length) : "0"} />
            </div>
          </div>

          {result ? (
            <div className="space-y-4">
              <Panel title={result.product.title} eyebrow="Product">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Current price" value={formatCurrency(result.product.productPrice)} />
                  <Detail label="MRP" value={formatCurrency(result.product.mrp)} />
                  <Detail label="Delivery" value={formatCurrency(result.product.deliveryFee)} />
                  <Detail label="SKU" value={result.product.sku ?? "Not found"} />
                </div>
              </Panel>

              <Panel title="Pricing breakdown" eyebrow="Deal math">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Bank discount" value={formatCurrency(pricing?.bankDiscount)} />
                  <Detail label="Coupon discount" value={formatCurrency(pricing?.couponDiscount)} />
                  <Detail label="Cashback" value={formatCurrency(pricing?.cashbackValue)} />
                  <Detail label="EMI extra cost" value={formatCurrency(pricing?.emiExtraCost)} />
                </div>
              </Panel>

              <Panel title="Offers" eyebrow="Extracted from Flipkart">
                <div className="space-y-3">
                  {result.offers.map((offer) => {
                    const eligible = eligibleOfferIds.has(offer.id);
                    const eligibility = result.pricingAnalysis.eligibility.find((item) => item.offerId === offer.id);
                    return (
                      <div key={offer.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-white">{offer.title}</p>
                            <p className="mt-1 text-sm text-slate-400">{offer.type.replace(/_/g, " ")}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${eligible ? "bg-emerald-400/15 text-emerald-200" : "bg-slate-500/15 text-slate-300"}`}>
                            {eligible ? "Eligible" : "Not eligible"}
                          </span>
                        </div>
                        {eligibility?.reason ? <p className="mt-2 text-sm text-slate-400">{eligibility.reason}</p> : null}
                      </div>
                    );
                  })}
                  {result.offers.length === 0 ? <p className="text-sm text-slate-400">No offers were extracted from this page.</p> : null}
                </div>
              </Panel>
            </div>
          ) : (
            <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/3 p-6 text-sm leading-6 text-slate-400">
              The output panel will summarize the detected product, offer stack, and deterministic deal math once a URL is analyzed.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/20 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">{eyebrow}</p>
      <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

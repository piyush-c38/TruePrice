import type {
  AnalysisResult,
  EligibilityResult,
  Offer,
  PricingBreakdown,
  ProductInfo,
  UserContext,
} from "@/lib/schemas";

type PricingInput = {
  product: ProductInfo;
  offers: Offer[];
  userContext?: UserContext;
  sourceUrl?: string;
};

/**
 * Main entry:
 * computeBestOffer({ product, offers, userContext })
 * returns a partial AnalysisResult with pricing, bestOfferIds, eligibility, verdict and explanation.
 */
export async function computeBestOffer(input: PricingInput) {
  const product = input.product;
  const offers = input.offers ?? [];
  const userContext = input.userContext ?? {};

  const eligibility = offers.map((o) => checkEligibility(o, product, userContext));

  const eligibleOffers = offers.filter((o) =>
    eligibility.find((e) => e.offerId === o.id && e.isEligible)
  );

  const combos = generateAllowedCombos(eligibleOffers);

  let best = {
    combo: [] as Offer[],
    pricing: makeEmptyPricing(product),
  };

  for (const combo of combos) {
    const pricing = evaluateCombo(combo, product, userContext);
    if (best.combo.length === 0 || pricing.effectiveCost < best.pricing.effectiveCost) {
      best = { combo, pricing };
    }
  }

  const bestOfferIds = best.combo.map((o) => o.id);

  const verdict = buildVerdict(product, best.pricing);

  const explanation = buildExplanation(best.combo, best.pricing);

  const analysis: Partial<AnalysisResult> = {
    platform: input.product ? "amazon" : ("flipkart" as any), // will be filled by caller normally
    product,
    offers,
    eligibility,
    bestOfferIds,
    pricing: best.pricing,
    verdict,
    explanation,
    metadata: {
      sourceUrl: input.sourceUrl ?? "",
      fetchedAt: new Date().toISOString(),
    },
  };

  return analysis;
}

/* ----------------- Eligibility ----------------- */

function checkEligibility(
  offer: Offer,
  product: ProductInfo,
  userContext: UserContext | undefined
): EligibilityResult {
  const price = product.productPrice ?? 0;
  if (offer.minPurchaseAmount && price < offer.minPurchaseAmount) {
    return { offerId: offer.id, isEligible: false, reason: `Requires min purchase ₹${offer.minPurchaseAmount}` };
  }

  if (offer.requiresEmi && userContext?.paymentMethod !== "emi") {
    return { offerId: offer.id, isEligible: false, reason: "Requires EMI payment option" };
  }

  if (offer.bank && userContext?.bankName && !matchBankSimple(offer.bank, userContext.bankName)) {
    return { offerId: offer.id, isEligible: false, reason: `Requires bank ${offer.bank}` };
  }

  return { offerId: offer.id, isEligible: true };
}

function matchBankSimple(offerBank: string | null, userBank: string | null) {
  if (!offerBank || !userBank) return true;
  return offerBank.toLowerCase().includes(userBank.toLowerCase()) || userBank.toLowerCase().includes(offerBank.toLowerCase());
}

/* ----------------- Combo generation rules -----------------
  - Allow at most: 1 coupon, 1 bank_discount, 1 emi in a combo.
  - cashback may be combined with others.
  - non-stackable offers are only allowed singly.
  - limit combo size to 4 to avoid explosion.
----------------------------------------------------------- */

function generateAllowedCombos(offers: Offer[]) {
  const results: Offer[][] = [];
  const n = offers.length;
  const maxComboSize = Math.min(4, n);

  // power set limited
  const total = 1 << n;
  for (let mask = 1; mask < total; mask++) {
    const combo: Offer[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) combo.push(offers[i]);
    if (combo.length === 0 || combo.length > maxComboSize) continue;

    // if any non-stackable present, only allow size 1
    const hasNonStackable = combo.some((o) => !o.isStackable);
    if (hasNonStackable && combo.length > 1) continue;

    // at most one coupon, one bank_discount, one emi
    const typeCounts: Record<string, number> = {};
    combo.forEach((o) => (typeCounts[o.type] = (typeCounts[o.type] || 0) + 1));
    if ((typeCounts["coupon"] ?? 0) > 1) continue;
    if ((typeCounts["bank_discount"] ?? 0) > 1) continue;
    if ((typeCounts["emi"] ?? 0) > 1) continue;

    results.push(combo);
  }

  // also include empty combo (no offers)
  results.push([]);
  return results;
}

/* ----------------- Pricing evaluation ----------------- */

function makeEmptyPricing(product: ProductInfo): PricingBreakdown {
  const base = product.productPrice ?? 0;
  return {
    basePrice: base,
    deliveryFee: product.deliveryFee ?? 0,
    instantDiscount: 0,
    couponDiscount: 0,
    bankDiscount: 0,
    cashbackValue: 0,
    emiExtraCost: 0,
    finalPayableNow: base + (product.deliveryFee ?? 0),
    delayedBenefit: 0,
    effectiveCost: base + (product.deliveryFee ?? 0),
    details: {},
  };
}

function evaluateCombo(combo: Offer[], product: ProductInfo, userContext?: UserContext): PricingBreakdown {
  const base = product.productPrice ?? 0;
  const delivery = product.deliveryFee ?? 0;

  let instantDiscount = 0;
  let couponDiscount = 0;
  let bankDiscount = 0;
  let cashbackValue = 0;
  let emiExtraCost = 0;

  for (const o of combo) {
    if (o.type === "cashback") {
      cashbackValue += extractOfferAmount(o);
      continue;
    }

    // compute discount amount (flat or percentage)
    const amount = computeOfferDiscountAmount(o, base);
    if (o.type === "coupon") couponDiscount += amount;
    else if (o.type === "bank_discount") bankDiscount += amount;
    else if (o.type === "emi") {
      // treat EMI discount as instant reduction if present
      instantDiscount += amount;
      // emi extra cost: if user chose EMI and offer not no-cost -> approximate small fee
      const noCost = Boolean(o.metadata && (o.metadata as any).noCostEmi);
      if (!noCost && (userContext?.paymentMethod === "emi" || o.requiresEmi)) {
        emiExtraCost += Math.round(base * 0.02); // simple 2% extra approximation for non no-cost EMI
      }
    } else {
      // other/flat offers treated as instant
      instantDiscount += amount;
    }
  }

  // Instant discounts are those that reduce the payable now (we treat bank and coupon and instant flags accordingly)
  // However we keep couponDiscount and bankDiscount separate for breakdown clarity.
  // final payable now:
  const payableNow = Math.max(0, base + delivery - instantDiscount - couponDiscount - bankDiscount);

  const delayedBenefit = cashbackValue;

  const effectiveCost = Math.max(0, payableNow - delayedBenefit + emiExtraCost);

  return {
    basePrice: base,
    deliveryFee: delivery,
    instantDiscount,
    couponDiscount,
    bankDiscount,
    cashbackValue,
    emiExtraCost,
    finalPayableNow: payableNow,
    delayedBenefit,
    effectiveCost,
    details: {
      comboSize: combo.length,
      offerIds: combo.map((o) => o.id).join(","),
    },
  };
}

function computeOfferDiscountAmount(offer: Offer, base: number): number {
  const v = offer.discountValue ?? 0;
  if (!v) return 0;
  if (offer.discountType === "percentage") {
    const raw = (v / 100) * base;
    if (offer.maxDiscount) return Math.min(raw, offer.maxDiscount);
    return raw;
  }
  // flat
  return v;
}

function extractOfferAmount(offer: Offer): number {
  // For cashback offers we expect discountValue to be the cashback amount if present
  if (offer.discountType === "percentage" && offer.discountValue) {
    // percent cashback on base is ambiguous; skip percentage cashback for now
    return 0;
  }
  return offer.discountValue ?? 0;
}

/* ----------------- Verdict/explanation ----------------- */

function buildVerdict(product: ProductInfo, pricing: PricingBreakdown) {
  const base = product.productPrice ?? 0;
  const savingsPct = base > 0 ? ((base - pricing.effectiveCost) / base) * 100 : 0;
  const score = Math.max(0, Math.min(10, Math.round((savingsPct / 10) * 2))); // rough scale
  const label = score >= 8 ? "Excellent" : score >= 5 ? "Good" : score >= 3 ? "Marginal" : "Poor";
  const shortText = `${label} deal (${savingsPct.toFixed(1)}% effective savings)`;
  return { score, label, shortText };
}

function buildExplanation(combo: Offer[], pricing: PricingBreakdown) {
  if (combo.length === 0) {
    return `No eligible offers. Pay ₹${pricing.finalPayableNow.toFixed(0)} now.`;
  }
  const parts = combo.map((o) => `${o.title}`);
  return `Applied ${parts.join(" + ")} → Pay ₹${pricing.finalPayableNow.toFixed(0)} now, effective cost ₹${pricing.effectiveCost.toFixed(0)}.`;
}
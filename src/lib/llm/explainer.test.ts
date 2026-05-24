import { afterEach, describe, expect, it, vi } from "vitest";

import { generateDealExplanation } from "@/lib/llm/explainer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generateDealExplanation", () => {
  it("falls back to the deterministic explanation when no API key is configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    const result = await generateDealExplanation({
      sourceUrl: "https://www.flipkart.com/item",
      product: {
        title: "Example Product",
        productPrice: 899,
        mrp: 999,
        deliveryFee: 0,
      },
      pricing: {
        basePrice: 899,
        deliveryFee: 0,
        instantDiscount: 0,
        couponDiscount: 0,
        bankDiscount: 45,
        cashbackValue: 20,
        emiExtraCost: 0,
        finalPayableNow: 854,
        delayedBenefit: 20,
        effectiveCost: 834,
        details: {},
      },
      bestOffers: [],
      eligibility: [],
      fallbackExplanation: "Applied Bank Offer → Pay ₹854 now, effective cost ₹834.",
    });

    expect(result).toEqual({
      text: "Applied Bank Offer → Pay ₹854 now, effective cost ₹834.",
      source: "deterministic",
      model: null,
    });
  });

  it("uses the OpenAI response when configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_MODEL", "gpt-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Best deal is the HDFC bank offer." } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      ) as typeof fetch
    );

    const result = await generateDealExplanation({
      sourceUrl: "https://www.flipkart.com/item",
      product: {
        title: "Example Product",
        productPrice: 899,
        mrp: 999,
        deliveryFee: 0,
      },
      pricing: {
        basePrice: 899,
        deliveryFee: 0,
        instantDiscount: 0,
        couponDiscount: 0,
        bankDiscount: 45,
        cashbackValue: 20,
        emiExtraCost: 0,
        finalPayableNow: 854,
        delayedBenefit: 20,
        effectiveCost: 834,
        details: {},
      },
      bestOffers: [],
      eligibility: [],
      fallbackExplanation: "Applied Bank Offer → Pay ₹854 now, effective cost ₹834.",
    });

    expect(result).toEqual({
      text: "Best deal is the HDFC bank offer.",
      source: "llm",
      model: "gpt-test",
    });
  });
});
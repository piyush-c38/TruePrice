import type { Offer, PricingBreakdown, UserContext } from "@/lib/schemas";

type ExplanationSource = "llm" | "deterministic";

type ExplainerInput = {
  sourceUrl: string;
  product: {
    title: string;
    productPrice: number;
    mrp: number | null;
    deliveryFee: number | null;
  };
  pricing: PricingBreakdown;
  bestOffers: Offer[];
  eligibility: Array<{
    offerId: string;
    isEligible: boolean;
    reason?: string | null;
  }>;
  userContext?: UserContext;
  fallbackExplanation: string;
  fetchImpl?: typeof fetch;
};

type ExplainResult = {
  text: string;
  source: ExplanationSource;
  model: string | null;
};

export async function generateDealExplanation(input: ExplainerInput): Promise<ExplainResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";

  if (!apiKey) {
    return {
      text: input.fallbackExplanation,
      source: "deterministic",
      model: null,
    };
  }

  const fetcher = input.fetchImpl ?? fetch;
  const payload = {
    product: input.product,
    pricing: input.pricing,
    bestOffers: input.bestOffers.map((offer) => ({
      id: offer.id,
      title: offer.title,
      type: offer.type,
      bank: offer.bank,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      maxDiscount: offer.maxDiscount,
      requiresEmi: offer.requiresEmi,
      emiMonths: offer.emiMonths,
      minPurchaseAmount: offer.minPurchaseAmount,
      isInstant: offer.isInstant,
      isStackable: offer.isStackable,
    })),
    eligibility: input.eligibility,
    userContext: input.userContext,
    sourceUrl: input.sourceUrl,
  };

  const response = await fetcher("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "You are a concise shopping assistant. Write a short, plain-English explanation of the best Flipkart deal using only the provided data. Do not mention policies, confidence, or any unsupported assumptions. Return plain text only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Summarize the best deal in 2-3 sentences.",
            ...payload,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    return {
      text: input.fallbackExplanation,
      source: "deterministic",
      model,
    };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const text = normalizeExplanation(data.choices?.[0]?.message?.content ?? "");
  if (!text) {
    return {
      text: input.fallbackExplanation,
      source: "deterministic",
      model,
    };
  }

  return {
    text,
    source: "llm",
    model,
  };
}

function normalizeExplanation(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}
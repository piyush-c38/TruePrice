import { load } from "cheerio";

import type { Offer } from "@/lib/schemas";
import type {
  ExtractedPageData,
  ExtractorInput,
  PlatformExtractor,
} from "@/lib/extractors/types";

const FLIPKART_BANKS = [
  "HDFC",
  "SBI",
  "ICICI",
  "Axis",
  "Kotak",
  "Yes Bank",
  "RBL",
  "IDFC",
  "IndusInd",
  "PNB",
  "Federal",
  "HSBC",
  "Standard Chartered",
  "OneCard",
  "AU Small Finance",
  "Bajaj Finserv",
  "Amazon Pay",
] as const;

const OFFER_CARD_SELECTORS = [".uOLsQg", "._3xx7bM", ".YxlyUe", ".W7xQ0_", "._4f7J8H", ".t2bCco"].join(", ");

const OFFER_KEYWORDS = [
  "bank offer",
  "cashback",
  "coupon",
  "partner offer",
  "partner offers",
  "emi",
  "no cost emi",
  "no-cost emi",
  "discount",
  "instant discount",
  "save up to",
  "reward points",
  "supercoins",
  "voucher",
  "promo code",
  "apply offer",
];

export const flipkartExtractor: PlatformExtractor = {
  platform: "flipkart",
  version: "flipkart-dom-v3",
  async extract(input: ExtractorInput): Promise<ExtractedPageData> {
    const $ = load(input.html);

    const pageTitle = firstNonEmpty([
      getMeta($, "og:title"),
      getMeta($, "twitter:title"),
      normalizeText($("title").first().text()),
    ]);

    const title =
      sanitizeProductTitle(
        firstNonEmpty([
          normalizeText($("span.B_NuCI").first().text()),
          normalizeText($("._35KyD6").first().text()),
          normalizeText($("._2rQP1z").first().text()),
          normalizeText($("h1").first().text()),
          pageTitle,
        ]) ?? "Unknown product",
      ) ?? "Unknown product";

    const productPrice = extractProductPrice($);
    const mrp = extractMrp($);
    const deliveryFee = extractDeliveryFee($);
    const offers = extractOffers($, input.url);

    return {
      platform: "flipkart",
      product: {
        title,
        productPrice,
        mrp: mrp ?? null,
        deliveryFee: deliveryFee ?? null,
        currency: "INR",
        sku: extractSku($),
      },
      offers,
      pageTitle: pageTitle ?? null,
      extractorVersion: flipkartExtractor.version,
    };
  },
};

function extractOffers($: ReturnType<typeof load>, sourceUrl: string): Offer[] {
  const collected = new Map<string, Offer>();

  // 1) Prefer explicit visible offer cards near the price area.
  const visibleCards = $(OFFER_CARD_SELECTORS)
    .map((_, element) => normalizeText($(element).text() ?? ""))
    .get()
    .map(cleanOfferText)
    .flatMap(splitCompoundOfferText)
    .filter(isShortOfferText)
    .filter(isLikelyOfferCardText);

  for (const [index, text] of visibleCards.entries()) {
    const offer = buildOfferFromText(text, index, sourceUrl);
    if (offer) collected.set(offer.id, offer);
  }

  // 2) If no visible cards were found, inspect the small offer summary text area only.
  if (collected.size === 0) {
    const summaries = findOfferSummaryTexts($);

    for (const [index, text] of summaries.entries()) {
      const offer = buildOfferFromText(text, index, sourceUrl);
      if (offer) collected.set(offer.id, offer);
    }
  }

  return dedupeOffers(Array.from(collected.values()));
}

function buildOfferFromText(text: string, index: number, sourceUrl: string): Offer | null {
  const safe = cleanOfferText(text).slice(0, 250);
  if (!safe || safe.length < 8 || isNoiseText(safe)) return null;
  if (/^bank offers?$/i.test(safe)) return null;

  const normalizedTitle = normalizeOfferTitle(safe);
  if (!normalizedTitle || /^bank offers?$/i.test(normalizedTitle)) return null;

  const lower = normalizedTitle.toLowerCase();
  const bank = matchBank(normalizedTitle);
  const isCashback = /cashback|reward points|supercoins|wallet credit|pay balance/.test(lower);
  const isCoupon = /coupon|promo code|voucher|apply code|offer code/.test(lower);
  const isEmi = /\bemi\b/.test(lower);
  const isPartner = /partner offer|partner offers|business purchases|gst invoice/.test(lower);
  const hasBankDiscount = /bank offer|instant discount|additional discount|save instantly|credit card/.test(lower);

  let type: Offer["type"] = "other";
  if (isCashback) type = "cashback";
  else if (isCoupon) type = "coupon";
  else if (isEmi) type = "emi";
  else if (bank || hasBankDiscount) type = "bank_discount";
  else return null;

  const discountType = inferDiscountType(normalizedTitle);
  const discountValue = type === "emi" ? parseEmiDiscountValue(normalizedTitle) : parseDiscountValue(normalizedTitle);
  const maxDiscount = parseMaxDiscount(normalizedTitle);
  const minPurchaseAmount = parseMinimumPurchase(normalizedTitle);
  const emiMonths = parseEmiMonths(normalizedTitle);
  const noCostEmi = type === "emi" && /no[- ]cost emi/i.test(normalizedTitle);

  return {
    id: makeOfferId(type, normalizedTitle, index, sourceUrl),
    type,
    title: normalizedTitle,
    discountType,
    discountValue,
    maxDiscount,
    bank,
    requiresEmi: isEmi,
    emiMonths,
    minPurchaseAmount,
    isInstant: type === "bank_discount" || type === "coupon",
    isStackable: type !== "cashback" && !isPartner,
    expiryText: extractValidityText(normalizedTitle),
    rawText: normalizedTitle,
    metadata: {
      sourceUrl,
      detectedBy: "flipkart-extractor",
      noCostEmi,
      category: isPartner ? "partner" : isCashback ? "cashback" : isCoupon ? "coupon" : isEmi ? "emi" : bank ? "bank" : "other",
    },
  };
}

function extractProductPrice($: ReturnType<typeof load>): number {
  const candidates = [
    extractPriceFromJsonLd($),
    normalizeText($("div.Nx9bqj.CxhGGd").first().text()),
    normalizeText($("div.Nx9bqj").first().text()),
    normalizeText($("div._30jeq3._16Jk6d").first().text()),
    normalizeText($("div._30jeq3").first().text()),
    normalizeText($("._30jeq3").first().text()),
    normalizeText($("._1_WHN1").first().text()),
    getMeta($, "product:price:amount") ?? "",
  ];

  for (const candidate of candidates) {
    const value = parseMoneyFromText(candidate);
    if (value && value > 0) return value;
  }

  return 0;
}

function extractMrp($: ReturnType<typeof load>): number | null {
  const candidates = [
    normalizeText($("div._3I9_wc").first().text()),
    normalizeText($("._3I9_wc").first().text()),
    normalizeText($("span._2jc4yl").first().text()),
    normalizeText(findFirstKeywordText($, ["mrp", "list price", "strike price"])),
  ];

  for (const candidate of candidates) {
    const value = parseMoneyFromText(candidate);
    if (value && value > 0) return value;
  }

  return null;
}

function extractDeliveryFee($: ReturnType<typeof load>): number | null {
  const candidates = [
    normalizeText(findFirstKeywordText($, ["free delivery", "delivery by", "delivered by"])),
    normalizeText($("body").text()),
  ];

  for (const candidate of candidates) {
    const fee = parseDeliveryFee(candidate);
    if (fee !== null) return fee;
  }

  return null;
}

function isMeaningfulOfferText(text: string): boolean {
  if (isNoiseText(text)) return false;
  const lower = text.toLowerCase();
  const keywordHit = OFFER_KEYWORDS.some((keyword) => lower.includes(keyword));
  const moneyHit = /₹|inr|rs\.?|\d+(?:\.\d+)?%/i.test(text);
  return keywordHit && (moneyHit || /offer|discount|cashback|emi/i.test(text));
}

function isLikelyOfferCardText(text: string): boolean {
  if (!isMeaningfulOfferText(text)) return false;
  const lower = text.toLowerCase();
  const startsAsOffer = (
    lower.startsWith("bank offer") ||
    lower.startsWith("bank offers") ||
    lower.startsWith("cashback") ||
    lower.startsWith("partner offers") ||
    lower.startsWith("partner offer") ||
    lower.startsWith("no cost emi") ||
    lower.startsWith("no-cost emi") ||
    lower.startsWith("apply offer")
  );

  const hasValueSignal = /₹\s*\d|\d+%|cashback|emi/i.test(lower);
  return startsAsOffer && hasValueSignal;
}

function isShortOfferText(text: string): boolean {
  return text.length > 10 && text.length < 220;
}

function isNoiseText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.length > 300 ||
    text.includes("<div") ||
    text.includes("<script") ||
    lower.includes("recently viewed") ||
    lower.includes("featured recommendations") ||
    lower.includes("browsing history") ||
    lower.includes("dimension-slot-info") ||
    lower.includes("inline-twister") ||
    lower.includes("similar products") ||
    /[a-z0-9+/]{80,}={0,2}/i.test(text)
  );
}

function cleanOfferText(text: string): string {
  return normalizeText(text)
    .replace(/see details/gi, "")
    .replace(/show more/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findFirstKeywordText($: ReturnType<typeof load>, keywords: string[]): string {
  const results: string[] = [];
  $("body")
    .find("*")
    .each((_, element) => {
      const text = normalizeText($(element).text() ?? "");
      if (!text || text.length > 350) return;
      const lower = text.toLowerCase();
      if (keywords.some((keyword) => lower.includes(keyword))) {
        results.push(text);
      }
    });
  return results[0] ?? "";
}

function findOfferSummaryTexts($: ReturnType<typeof load>): string[] {
  const results = new Set<string>();

  $("body")
    .find("*")
    .each((_, element) => {
      const text = cleanOfferText(normalizeText($(element).text() ?? ""));
      if (!text || text.length > 260) return;
      if (isLikelyOfferCardText(text)) {
        for (const part of splitCompoundOfferText(text)) {
          results.add(part);
        }
      }
    });

  return Array.from(results).slice(0, 6);
}

function extractSku($: ReturnType<typeof load>): string | null {
  const candidates = [
    $("meta[itemprop='sku']").attr("content"),
    getMeta($, "sku"),
    getMeta($, "product:retailer_item_id"),
  ];
  return firstNonEmpty(candidates) ?? null;
}

function parseDeliveryFee(text: string): number | null {
  if (!text) return null;
  if (/free delivery|free shipping|no delivery charge/i.test(text)) return 0;
  const match = text.match(/delivery(?: charge| fee)?[^₹]*₹\s*([\d,]+(?:\.\d+)?)/i);
  if (match) return Number(match[1].replace(/,/g, ""));
  return null;
}

function dedupeOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  const out: Offer[] = [];
  for (const offer of offers) {
    const normalized = normalizeOfferTitle(offer.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const key = `${offer.type}::${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offer.title = normalizeOfferTitle(offer.title);
    offer.rawText = offer.title;
    out.push(offer);
  }
  return out;
}

function inferDiscountType(text: string): "flat" | "percentage" | null {
  if (/%/.test(text)) return "percentage";
  if (/₹|rs\.?|inr/i.test(text)) return "flat";
  return null;
}

function parseDiscountValue(text: string): number | null {
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Number(pct[1]);
  const amt = text.match(/₹\s?([\d,]+(?:\.\d+)?)/);
  if (amt) return Number(amt[1].replace(/,/g, ""));
  return null;
}

function parseEmiDiscountValue(text: string): number | null {
  if (/unlock\s*₹/i.test(text)) {
    return null;
  }
  return parseDiscountValue(text);
}

function extractPriceFromJsonLd($: ReturnType<typeof load>): string {
  const scripts = $("script[type='application/ld+json']")
    .map((_, element) => $(element).contents().text())
    .get();

  for (const scriptText of scripts) {
    try {
      const parsed = JSON.parse(scriptText);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const price = getPriceFromJsonLdNode(entry);
        if (price) {
          return `₹${price}`;
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }

  return "";
}

function getPriceFromJsonLdNode(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  const asRecord = node as Record<string, unknown>;

  if (typeof asRecord.price === "string" || typeof asRecord.price === "number") {
    const value = String(asRecord.price).replace(/[^\d.]/g, "");
    return value || null;
  }

  const offers = asRecord.offers;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const value = getPriceFromJsonLdNode(offer);
      if (value) return value;
    }
  } else if (offers && typeof offers === "object") {
    const value = getPriceFromJsonLdNode(offers);
    if (value) return value;
  }

  return null;
}

function splitCompoundOfferText(text: string): string[] {
  const normalized = cleanOfferText(text);

  if (/best value for you/i.test(normalized) && /apply/i.test(normalized)) {
    const amounts = Array.from(normalized.matchAll(/₹\s*([\d,]+)\s*off/gi), (match) => Number(match[1].replace(/,/g, "")));
    const best = amounts.length ? Math.max(...amounts) : null;
    if (best) {
      return [`Cashback up to ₹${best} off`];
    }
  }

  return [normalized];
}

function normalizeOfferTitle(text: string): string {
  return cleanOfferText(text)
    .replace(/\b(Bank offers?)(?:\s*\1)+\b/gi, "$1")
    .replace(/\b(Bank offers?)\s*(Bank offers?)\b/gi, "$1")
    .replace(/\|\s*\|/g, "|")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeProductTitle(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\.\.\.more$/i, "").trim();
}

function parseMaxDiscount(text: string): number | null {
  const match =
    text.match(/up to\s*₹\s?([\d,]+(?:\.\d+)?)/i) ||
    text.match(/max(?:imum)?\s*₹\s?([\d,]+(?:\.\d+)?)/i);
  if (match) return Number(match[1].replace(/,/g, ""));
  return null;
}

function parseMinimumPurchase(text: string): number | null {
  const match =
    text.match(/minimum purchase value\s*(?:INR|₹)\s*([\d,]+(?:\.\d+)?)/i) ||
    text.match(/min(?:imum)? purchase.*?(?:INR|₹)\s*([\d,]+(?:\.\d+)?)/i) ||
    text.match(/purchase value\s*(?:INR|₹)\s*([\d,]+(?:\.\d+)?)/i);
  if (match) return Number(match[1].replace(/,/g, ""));
  return null;
}

function parseEmiMonths(text: string): number[] | null {
  const months = Array.from(text.matchAll(/(\d+)\s*(?:month|months|mos)\b/gi), (match) => Number(match[1]));
  return months.length ? Array.from(new Set(months)) : null;
}

function extractValidityText(text: string): string | null {
  const match = text.match(/(valid(?: till| until)?[^.\n]*)/i);
  return match ? normalizeText(match[1]) : null;
}

function matchBank(text: string): string | null {
  const found = FLIPKART_BANKS.find((bank) => new RegExp(`\\b${escapeRegExp(bank)}\\b`, "i").test(text));
  return found ?? null;
}

function getMeta($: ReturnType<typeof load>, name: string): string | null {
  const meta = $("meta").filter((_, element) => {
    const $element = $(element);
    const key = ($element.attr("property") ?? $element.attr("name") ?? "").toLowerCase();
    return key === name.toLowerCase();
  });
  const content = normalizeText(meta.first().attr("content") ?? "");
  return content || null;
}

function parseMoneyFromText(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/₹\s*([0-9]+(?:\.[0-9]+)?)/);
  if (match) return Number(match[1]);
  const inrMatch = text.replace(/,/g, "").match(/(?:INR|Rs\.?|Rs)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (inrMatch) return Number(inrMatch[1]);
  return null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeText(value ?? "");
    if (normalized) return normalized;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function makeOfferId(type: Offer["type"], title: string, index: number, sourceUrl: string): string {
  const sourceToken = sourceUrl
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  const titleToken = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

  return `flipkart-${type}-${index}-${sourceToken}-${titleToken || "offer"}`;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

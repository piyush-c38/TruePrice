import { load } from "cheerio";

import type { Offer, Platform, ProductInfo } from "@/lib/schemas";
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
  "Bajaj",
  "OneCard",
  "Amazon Pay",
] as const;

export const flipkartExtractor: PlatformExtractor = {
  platform: "flipkart",
  version: "flipkart-dom-v1",
  async extract(input: ExtractorInput): Promise<ExtractedPageData> {
    const $ = load(input.html);

    const pageTitle = firstNonEmpty([
      getMeta($, "og:title"),
      getMeta($, "twitter:title"),
      normalizeText($("title").first().text()),
    ]);

    const title =
      firstNonEmpty([
        normalizeText($("span.B_NuCI").first().text()),
        normalizeText($("._35KyD6").first().text()),
        normalizeText($("._2rQP1z").first().text()),
        pageTitle,
      ]) ?? "Unknown product";

    const productPrice =
      parseMoneyFromText(
        firstNonEmpty([
          normalizeText($("div._30jeq3._16Jk6d").first().text()),
          normalizeText($("div._30jeq3").first().text()),
          getMeta($, "product:price:amount"),
          normalizeText(extractFirstOfferText($, ["price", "dealprice", "ourprice"])),
        ]) ?? ""
      ) ?? 0;

    const mrp = parseMoneyFromText(
      firstNonEmpty([
        normalizeText($("div._3I9_wc").first().text()),
        normalizeText($("._3I9_wc").first().text()),
        normalizeText(extractFirstOfferText($, ["mrp", "list price", "strike price"])),
      ]) ?? ""
    );

    const deliveryFee = parseDeliveryFee(
      firstNonEmpty([
        normalizeText($("#container").text()),
        normalizeText($("body").text()),
      ]) ?? ""
    );

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
  const selectors = [
    ".uOLsQg", // Flipkart offers blocks (site varies)
    "._3xx7bM", // some offer classes
    ".YxlyUe", // coupon/offer blocks
    "[data-testid='offers']",
    "[data-testid='offers-section']",
  ].join(", ");

  const sectionText = normalizeText($(selectors).text());
  const bodyText = normalizeText($("body").text());
  const combined = [sectionText, bodyText].filter(Boolean).join("\n");
  const lines = splitMeaningfulLines(combined);
  const offerLines = lines.filter((l) => looksLikeOfferLine(l));

  const offers = offerLines
    .map((line, index) => buildOfferFromLine(line, index, sourceUrl))
    .filter((o): o is Offer => o !== null);

  return dedupeOffers(offers);
}

function buildOfferFromLine(line: string, index: number, sourceUrl: string): Offer | null {
  const lower = line.toLowerCase();
  const bank = matchBank(line);
  const requiresEmi = /emi/.test(lower);
  const isNoCostEmi = /no[- ]?cost emi/.test(lower) || /no cost emi/.test(lower);
  const isCashback = /cashback|supercoins|rewards|reward points|points back/.test(lower);
  const isCoupon = /coupon|promo code|use code|voucher/.test(lower);
  const hasBankDiscount = /bank offer|instant discount|extra discount|bank discount/.test(lower);

  let type: Offer["type"] = "other";
  if (isCashback) type = "cashback";
  else if (isCoupon) type = "coupon";
  else if (requiresEmi || isNoCostEmi) type = "emi";
  else if (bank || hasBankDiscount) type = "bank_discount";

  const discountType = inferDiscountType(line);
  const discountValue = parseDiscountValue(line);
  const maxDiscount = parseMaxDiscount(line);
  const minPurchaseAmount = parseMinimumPurchase(line);
  const emiMonths = parseEmiMonths(line);

  const normalizedTitle = normalizeText(line);
  if (!normalizedTitle) return null;

  return {
    id: makeOfferId(type, normalizedTitle, index, sourceUrl),
    type,
    title: normalizedTitle,
    discountType,
    discountValue,
    maxDiscount,
    bank,
    requiresEmi,
    emiMonths,
    minPurchaseAmount,
    isInstant: type === "bank_discount" || type === "coupon",
    isStackable: !isNoCostEmi && type !== "cashback",
    expiryText: extractValidityText(line),
    rawText: line,
    metadata: {
      sourceUrl,
      detectedBy: "flipkart-extractor",
      noCostEmi: isNoCostEmi,
    },
  };
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
  if (/free delivery|free shipping|no delivery charge/.test(text.toLowerCase())) return 0;
  return parseMoneyFromText(text);
}

function extractFirstOfferText($: ReturnType<typeof load>, keywords: string[]): string {
  const body = $("body");
  const result: string[] = [];
  body.find("*").each((_, el) => {
    const t = normalizeText($(el).text());
    if (!t) return;
    const lower = t.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) result.push(t);
  });
  return result[0] ?? "";
}

function looksLikeOfferLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    /discount|coupon|cashback|emi|bank|offer|save|voucher|promo|exchange|no cost|no-cost/.test(lower) &&
    line.length > 8
  );
}

function splitMeaningfulLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => normalizeText(l))
    .filter((l) => Boolean(l) && l.length > 6)
    .filter((l) => !/^flipkart$/i.test(l));
}

function dedupeOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  const out: Offer[] = [];
  for (const o of offers) {
    const key = `${o.type}::${o.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
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

function parseMaxDiscount(text: string): number | null {
  const m = text.match(/up to\s*₹\s?([\d,]+(?:\.\d+)?)/i) || text.match(/max(?:imum)?\s*₹\s?([\d,]+(?:\.\d+)?)/i);
  if (m) return Number(m[1].replace(/,/g, ""));
  return null;
}

function parseMinimumPurchase(text: string): number | null {
  const m = text.match(/(?:min(?:imum)?(?: purchase)?(?: of)?|on orders above)\s*₹\s?([\d,]+(?:\.\d+)?)/i)
    || text.match(/above\s*₹\s?([\d,]+(?:\.\d+)?)/i);
  if (m) return Number(m[1].replace(/,/g, ""));
  return null;
}

function parseEmiMonths(text: string): number[] | null {
  const months = Array.from(text.matchAll(/(\d+)\s*(?:month|months|mos)\b/gi), (m) => Number(m[1]));
  return months.length ? Array.from(new Set(months)) : null;
}

function extractValidityText(text: string): string | null {
  const m = text.match(/(valid(?: till| until)?[^.\n]*)/i);
  return m ? normalizeText(m[1]) : null;
}

function matchBank(text: string): string | null {
  const found = FLIPKART_BANKS.find((bank) => new RegExp(`\\b${escapeRegExp(bank)}\\b`, "i").test(text));
  return found ?? null;
}

function getMeta($: ReturnType<typeof load>, name: string): string | null {
  const meta = $("meta").filter((_, el) => {
    const $el = $(el);
    const key = (($el.attr("property") ?? $el.attr("name") ?? "") as string).toLowerCase();
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
  for (const v of values) {
    const n = normalizeText(v ?? "");
    if (n) return n;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function makeOfferId(type: Offer["type"], title: string, index: number, sourceUrl: string): string {
  const sourceToken = sourceUrl.replace(/^https?:\/\//i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  const titleToken = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return `flipkart-${type}-${index}-${sourceToken}-${titleToken || "offer"}`;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
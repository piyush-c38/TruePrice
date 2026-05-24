import { load } from "cheerio";

import type {
    Offer,
    Platform,
    ProductInfo,
} from "@/lib/schemas";

import type {
    ExtractedPageData,
    ExtractorInput,
    PlatformExtractor,
} from "@/lib/extractors/types";

const AMAZON_BANKS = [
    "HDFC",
    "SBI",
    "ICICI",
    "Axis",
    "Kotak",
    "Yes Bank",
    "RBL",
    "IDFC",
    "IndusInd",
    "Bank of Baroda",
    "PNB",
    "Federal",
    "HSBC",
    "Standard Chartered",
    "OneCard",
    "AU Small Finance",
    "Bajaj Finserv",
    "Amazon Pay",
] as const;

const OFFER_SECTION_SELECTORS = [
    "#availableOffersDisplay_feature_div",
    "#vpcButton",
    "#promoPriceBlockMessage_feature_div",
    "#promoPriceBlockMessage",
    "#apex_desktop_newAccordionRow",
    "#offersAccordionRow",
    "#percolate_feature_div",
    "#mir-layout-DELIVERY_BLOCK",
    "#deliveryMessageMirroringFeature_feature_div",
    "#delivery-message",
    "#ppd-claim",
    "[data-feature-name='promotion']",
].join(", ");

export const amazonExtractor: PlatformExtractor = {
    platform: "amazon",
    version: "amazon-dom-v1",
    async extract(input: ExtractorInput): Promise<ExtractedPageData> {
        const $ = load(input.html);
        const pageTitle = firstNonEmpty([
            getMeta($, "og:title"),
            getMeta($, "twitter:title"),
            normalizeText($("title").first().text()),
        ]);

        const title = firstNonEmpty([
            normalizeText($("#productTitle").first().text()),
            normalizeText($("h1#title").first().text()),
            normalizeText($("h1").first().text()),
            pageTitle,
        ]) ?? "Unknown product";

        const productPrice =
            parseMoneyFromText(
                firstNonEmpty([
                    normalizeText($("#corePriceDisplay_desktop_feature_div .a-offscreen").first().text()),
                    normalizeText($("#corePrice_feature_div .a-offscreen").first().text()),
                    normalizeText($("#priceblock_dealprice").first().text()),
                    normalizeText($("#priceblock_ourprice").first().text()),
                    normalizeText($(".a-price .a-offscreen").first().text()),
                    getMeta($, "product:price:amount"),
                    normalizeText(extractFirstOfferText($, ["price", "ourprice", "dealprice", "sale"])),
                ]) ?? "",
            ) ?? 0;

        const mrp = parseMoneyFromText(
            firstNonEmpty([
                normalizeText($(".priceBlockStrikePriceString").first().text()),
                normalizeText($(".a-text-price .a-offscreen").first().text()),
                normalizeText($("#listPrice").first().text()),
                normalizeText(extractFirstOfferText($, ["list price", "mrp", "strike price"])),
            ]) ?? "",
        );

        const deliveryFee = parseDeliveryFee(
            firstNonEmpty([
                normalizeText($("#mir-layout-DELIVERY_BLOCK").text()),
                normalizeText($("#delivery-message").text()),
                normalizeText($("#deliveryMessageMirroringFeature_feature_div").text()),
                normalizeText($("body").text()),
            ]) ?? "",
        );

        const offers = extractOffers($, input.url);

        return {
            platform: "amazon",
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
            extractorVersion: amazonExtractor.version,
        };
    },
};

function extractOffers($: ReturnType<typeof load>, sourceUrl: string): Offer[] {
    const bodyText = normalizeText($("body").text());
    const sectionText = normalizeText($(OFFER_SECTION_SELECTORS).text());
    const text = [sectionText, bodyText].filter(Boolean).join("\n");
    const lines = splitMeaningfulLines(text);
    const offerLines = lines.filter((line) => looksLikeOfferLine(line));

    const offers = offerLines
        .map((line, index) => buildOfferFromLine(line, index, sourceUrl))
        .filter((offer): offer is Offer => offer !== null);

    return dedupeOffers(offers);
}

function buildOfferFromLine(line: string, index: number, sourceUrl: string): Offer | null {
    const lower = line.toLowerCase();
    const bank = matchBank(line);
    const requiresEmi = /emi/.test(lower);
    const isNoCostEmi = /no[- ]?cost emi/.test(lower);
    const isCashback = /cashback|reward points?|supercoins|points? back/.test(lower);
    const isCoupon = /coupon|promo code|apply code|voucher/.test(lower);
    const hasBankDiscount = /instant discount|bank offer|bank discount|additional discount|save instantly/.test(lower);

    let type: Offer["type"] = "other";
    if (isCashback) {
        type = "cashback";
    } else if (isCoupon) {
        type = "coupon";
    } else if (requiresEmi || isNoCostEmi) {
        type = "emi";
    } else if (bank || hasBankDiscount) {
        type = "bank_discount";
    }

    const discountType = inferDiscountType(line);
    const discountValue = parseDiscountValue(line);
    const maxDiscount = parseMaxDiscount(line);
    const minPurchaseAmount = parseMinimumPurchase(line);
    const emiMonths = parseEmiMonths(line);

    const normalizedTitle = normalizeText(line);
    if (!normalizedTitle) {
        return null;
    }

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
            detectedBy: "amazon-extractor",
            noCostEmi: isNoCostEmi,
        },
    };
}

function extractSku($: ReturnType<typeof load>): string | null {
    const candidates = [
        $("#ASIN").attr("value"),
        $("input[name='ASIN']").attr("value"),
        $("input#ASIN").attr("value"),
        getMeta($, "sku"),
        getMeta($, "product:retailer_item_id"),
    ];

    return firstNonEmpty(candidates) ?? null;
}

function parseDeliveryFee(text: string): number | null {
    if (!text) {
        return null;
    }

    if (/free delivery|free shipping|no delivery charge/.test(text.toLowerCase())) {
        return 0;
    }

    return parseMoneyFromText(text);
}

function extractFirstOfferText($: ReturnType<typeof load>, keywords: string[]): string {
    const body = $("body");
    const result: string[] = [];

    body.find("*").each((_, element) => {
        const text = normalizeText($(element).text());
        if (!text) {
            return;
        }

        const lower = text.toLowerCase();
        if (keywords.some((keyword) => lower.includes(keyword))) {
            result.push(text);
        }
    });

    return result[0] ?? "";
}

function looksLikeOfferLine(line: string): boolean {
    const lower = line.toLowerCase();
    return (
        /discount|coupon|cashback|emi|bank|offer|save|reward|points|voucher|promo|exchange/.test(lower) &&
        line.length > 10
    );
}

function splitMeaningfulLines(text: string): string[] {
    return text
        .split(/\n+/)
        .map((line) => normalizeText(line))
        .filter((line): line is string => Boolean(line) && line.length > 6)
        .filter((line) => !/^amazon$/i.test(line))
        .filter((line) => !/^sign in$/i.test(line));
}

function dedupeOffers(offers: Offer[]): Offer[] {
    const seen = new Set<string>();
    const result: Offer[] = [];

    for (const offer of offers) {
        const key = `${offer.type}::${offer.title.toLowerCase()}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(offer);
    }

    return result;
}

function inferDiscountType(text: string): "flat" | "percentage" | null {
    if (/%/.test(text)) {
        return "percentage";
    }

    if (/₹|rs\.?|inr/i.test(text)) {
        return "flat";
    }

    return null;
}

function parseDiscountValue(text: string): number | null {
    const percentage = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentage) {
        return Number(percentage[1]);
    }

    const amount = text.match(/₹\s?([\d,]+(?:\.\d+)?)/);
    if (amount) {
        return Number(amount[1].replace(/,/g, ""));
    }

    return null;
}

function parseMaxDiscount(text: string): number | null {
    const matches = [
        text.match(/up to\s*₹\s?([\d,]+(?:\.\d+)?)/i),
        text.match(/max(?:imum)?\s*₹\s?([\d,]+(?:\.\d+)?)/i),
    ];

    for (const match of matches) {
        if (match) {
            return Number(match[1].replace(/,/g, ""));
        }
    }

    return null;
}

function parseMinimumPurchase(text: string): number | null {
    const match = text.match(/(?:min(?:imum)?(?: purchase)?(?: of)?|on orders above)\s*₹\s?([\d,]+(?:\.\d+)?)/i);
    if (match) {
        return Number(match[1].replace(/,/g, ""));
    }

    const afterWords = text.match(/above\s*₹\s?([\d,]+(?:\.\d+)?)/i);
    if (afterWords) {
        return Number(afterWords[1].replace(/,/g, ""));
    }

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
    const found = AMAZON_BANKS.find((bank) => new RegExp(`\\b${escapeRegExp(bank)}\\b`, "i").test(text));
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
    if (!text) {
        return null;
    }

    const match = text.replace(/,/g, "").match(/₹\s*([0-9]+(?:\.[0-9]+)?)/);
    if (match) {
        return Number(match[1]);
    }

    const inrMatch = text.replace(/,/g, "").match(/(?:INR|Rs\.?|Rs)\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (inrMatch) {
        return Number(inrMatch[1]);
    }

    return null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        const normalized = normalizeText(value ?? "");
        if (normalized) {
            return normalized;
        }
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

    return `amazon-${type}-${index}-${sourceToken}-${titleToken || "offer"}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

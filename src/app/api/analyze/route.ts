import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { flipkartExtractor } from "@/lib/extractors";
import { computeBestOffer } from "@/lib/pricing/engine";
import type { UserContext } from "@/lib/schemas";
import { fetchHtmlWithPlaywright } from "@/lib/fetchers/playwrightFetch";

type Body = {
    url: string;
    userContext?: UserContext;
};

function detectPlatform(url: string) {
    const u = url.toLowerCase();
    if (u.includes("flipkart")) return "flipkart";
    return null;
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as Body;
        if (!body?.url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

        const platform = detectPlatform(body.url);
        if (!platform) return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });

        // Fetch page HTML via Playwright
        let html: string;
        try {
            html = await fetchHtmlWithPlaywright(body.url);
        } catch (err: any) {
            return NextResponse.json({ error: "Failed to fetch page via Playwright", message: err?.message ?? String(err) }, { status: 502 });
        }

        // Choose extractor
        const extracted = await flipkartExtractor.extract({ url: body.url, html, platform: "flipkart" });

        // Run pricing engine
        const pricingAnalysis = await computeBestOffer({
            product: extracted.product,
            offers: extracted.offers,
            userContext: body.userContext,
            sourceUrl: body.url,
            platform: extracted.platform,
        });

        // Merge and return a single Analysis-like response
        const result = {
            platform: extracted.platform,
            product: extracted.product,
            offers: extracted.offers,
            pageTitle: extracted.pageTitle,
            extractorVersion: extracted.extractorVersion,
            pricingAnalysis,
        };

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
    }
}
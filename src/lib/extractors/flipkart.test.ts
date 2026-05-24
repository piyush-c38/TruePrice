import { describe, expect, it } from "vitest";

import { flipkartExtractor } from "@/lib/extractors";

describe("flipkartExtractor", () => {
  it("extracts the product price and filters visible offer cards", async () => {
    const html = `
      <html>
        <head>
          <title>Example Product</title>
          <meta property="og:title" content="Example Product">
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Product","offers":{"price":"899"}}
          </script>
        </head>
        <body>
          <span class="B_NuCI">Example Product...more</span>
          <div class="Nx9bqj CxhGGd">₹899</div>
          <div class="_3I9_wc">₹999</div>
          <div class="uOLsQg">Bank offer: 5% off up to ₹45 on HDFC Bank Credit Card</div>
          <div class="uOLsQg">No Cost EMI starting at ₹150/month for 6 months</div>
          <div class="uOLsQg">Recently viewed products</div>
        </body>
      </html>
    `;

    const result = await flipkartExtractor.extract({
      url: "https://www.flipkart.com/item",
      html,
      platform: "flipkart",
    });

    expect(result.product.title).toBe("Example Product");
    expect(result.product.productPrice).toBe(899);
    expect(result.product.mrp).toBe(999);
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]?.type).toBe("bank_discount");
    expect(result.offers[1]?.type).toBe("emi");
    expect(result.offers[1]?.metadata).toMatchObject({ noCostEmi: true });
  });
});
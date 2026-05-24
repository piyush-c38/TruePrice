import { describe, expect, it } from "vitest";

import { computeBestOffer } from "@/lib/pricing/engine";

describe("computeBestOffer", () => {
  it("chooses the best stack of eligible Flipkart offers", async () => {
    const result = await computeBestOffer({
      product: {
        title: "Example Product",
        productPrice: 899,
        mrp: 999,
        deliveryFee: 0,
        currency: "INR",
      },
      offers: [
        {
          id: "bank-hdfc",
          type: "bank_discount",
          title: "5% off up to ₹45 on HDFC Bank Credit Card",
          discountType: "percentage",
          discountValue: 5,
          maxDiscount: 45,
          bank: "HDFC",
          requiresEmi: false,
          emiMonths: null,
          minPurchaseAmount: null,
          isInstant: true,
          isStackable: true,
          expiryText: null,
          rawText: "5% off up to ₹45 on HDFC Bank Credit Card",
        },
        {
          id: "cashback-wallet",
          type: "cashback",
          title: "Get ₹20 cashback",
          discountType: "flat",
          discountValue: 20,
          maxDiscount: null,
          bank: null,
          requiresEmi: false,
          emiMonths: null,
          minPurchaseAmount: null,
          isInstant: false,
          isStackable: true,
          expiryText: null,
          rawText: "Get ₹20 cashback",
        },
      ],
      userContext: {
        bankName: "HDFC",
      },
      platform: "flipkart",
    });

    expect(result.bestOfferIds).toEqual(["bank-hdfc", "cashback-wallet"]);
    expect(result.pricing?.bankDiscount).toBeCloseTo(44.95, 2);
    expect(result.pricing?.cashbackValue).toBe(20);
    expect(result.pricing?.effectiveCost).toBeCloseTo(834.05, 2);
  });

  it("does not charge extra cost for no-cost EMI offers", async () => {
    const result = await computeBestOffer({
      product: {
        title: "Example Product",
        productPrice: 899,
        mrp: 999,
        deliveryFee: 0,
        currency: "INR",
      },
      offers: [
        {
          id: "emi-nce",
          type: "emi",
          title: "No Cost EMI starting at ₹150/month for 6 months",
          discountType: null,
          discountValue: null,
          maxDiscount: null,
          bank: null,
          requiresEmi: true,
          emiMonths: [6],
          minPurchaseAmount: null,
          isInstant: false,
          isStackable: true,
          expiryText: null,
          rawText: "No Cost EMI starting at ₹150/month for 6 months",
          metadata: { noCostEmi: true },
        },
      ],
      userContext: {
        paymentMethod: "emi",
      },
      platform: "flipkart",
    });

    expect(result.bestOfferIds).toEqual(["emi-nce"]);
    expect(result.pricing?.emiExtraCost).toBe(0);
    expect(result.pricing?.effectiveCost).toBe(899);
  });
});
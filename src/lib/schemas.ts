export type Platform = "flipkart";

export type OfferType =
  | "bank_discount"
  | "coupon"
  | "emi"
  | "cashback"
  | "exchange"
  | "other";

export type DiscountType = "flat" | "percentage";

export interface ProductInfo {
  title: string;
  productPrice: number; // current listed price (INR paise or rupees per project convention)
  mrp: number | null;
  deliveryFee: number | null;
  currency: "INR";
  sku?: string | null; // optional stock keeping unit for better offer matching; may be null if unavailable
}

export interface Offer {
  id: string; // stable id for referencing offers
  type: OfferType;
  title: string;
  discountType: DiscountType | null;
  discountValue: number | null; // if percentage, store percent (e.g., 10 for 10%)
  maxDiscount: number | null; // cap for percentage offers
  bank: string | null;
  requiresEmi: boolean;
  emiMonths: number[] | null; // available EMI tenors
  minPurchaseAmount: number | null;
  isInstant: boolean; // reduces payable now
  isStackable: boolean; // best-effort flag; engine must enforce rules
  expiryText: string | null; //Offer validity, e.g., "Valid till 31 Dec 2024"
  rawText: string; // original scraped offer text
  metadata?: Record<string, unknown> | null;
}

export interface UserContext {
  platform?: Platform | null;
  paymentMethod?: "credit_card" | "debit_card" | "upi" | "emi" | "wallet" | null;
  bankName?: string | null;
  cardName?: string | null;
  noCostEmiMonths?: number | null; // if user prefers no-cost EMI month option
}

export interface EligibilityResult {
  offerId: string;
  isEligible: boolean;
  reason?: string | null;
}

export interface PricingBreakdown {
  basePrice: number;
  deliveryFee: number;
  instantDiscount: number;
  couponDiscount: number;
  bankDiscount: number;
  cashbackValue: number;
  emiExtraCost: number; // additional cost due to interest/processing
  finalPayableNow: number; // amount to pay at checkout
  delayedBenefit: number; // cashback/wallet/points value
  effectiveCost: number; // finalPayableNow - delayedBenefit + emiExtraCost (or your chosen formula)
  details?: Record<string, number | string>;
}

export interface AnalysisResult {
  platform: Platform;
  product: ProductInfo;
  offers: Offer[];
  eligibility: EligibilityResult[];
  bestOfferIds: string[];
  pricing: PricingBreakdown;
  verdict: {
    score: number; // 0-10
    label: string; // e.g., "Excellent", "Good", "Marginal"
    shortText: string;
  };
  explanation: string; // concise human-readable explanation
  metadata: {
    sourceUrl: string;
    fetchedAt: string; // ISO timestamp
    pageTitle?: string | null;
    extractorVersion?: string | null;
  };
}
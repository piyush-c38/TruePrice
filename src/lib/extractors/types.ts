import type { Offer, Platform, ProductInfo } from "@/lib/schemas";

export interface ExtractorInput {
  url: string;
  html: string;
  platform: Platform;
}

export interface ExtractedPageData {
  platform: Platform;
  product: ProductInfo;
  offers: Offer[];
  pageTitle: string | null;
  extractorVersion: string;
}

export interface PlatformExtractor {
  platform: Platform;
  version: string;
  extract(input: ExtractorInput): Promise<ExtractedPageData>;
}
import { chromium } from "playwright";

export async function fetchHtmlWithPlaywright(url: string, timeout = 20000): Promise<string> {
  const browser = await chromium.launch({ args: ["--no-sandbox"], headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      viewport: { width: 1280, height: 800 },
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(700); // allow small JS to run
    return await page.content();
  } finally {
    await browser.close();
  }
}
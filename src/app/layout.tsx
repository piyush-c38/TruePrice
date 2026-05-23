import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TruePrice",
  description: "Analyze the true effective cost of Amazon and Flipkart deals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

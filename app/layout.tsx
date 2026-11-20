import type { Metadata } from "next";
import "./globals.css";
import { ui, mono } from "./fonts";
import brand from "@/brand.config";

export const metadata: Metadata = {
  title: brand.name,
  description: `${brand.name}: drafts for X, reviewed together`,
  icons: { icon: brand.logo },
  robots: { index: false, follow: false },
};

/** "#1D9BF0" → "29 155 240", the form Tailwind's color/<alpha> classes need. */
const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const vars = `:root{--accent:${rgb(brand.colors.accent)};--primary:${rgb(brand.colors.primary)};--on-primary:${rgb(brand.colors.onPrimary)}}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: vars }} />
      </head>
      <body className="min-h-screen bg-black font-sans text-white antialiased">{children}</body>
    </html>
  );
}

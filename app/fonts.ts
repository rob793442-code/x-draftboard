// The UI font. Swap Inter for any font on fonts.google.com (the import name is the family with underscores, e.g.
// Space_Grotesk), or use next/font/local for a font file you're licensed to ship.
import { Inter, JetBrains_Mono } from "next/font/google";

export const ui = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

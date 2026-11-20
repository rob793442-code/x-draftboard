import type { Config } from "tailwindcss";

// Brand colors come from brand.config.ts as CSS variables (set in app/layout.tsx), so `bg-accent/15` etc. work.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: v("accent"),
        primary: v("primary"),
        "on-primary": v("on-primary"),
      },
      fontFamily: {
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

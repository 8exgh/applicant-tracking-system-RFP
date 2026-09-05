import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "var(--brand-primary)",
        "brand-secondary": "var(--brand-secondary)",
      },
    },
  },
  plugins: [],
};
export default config;

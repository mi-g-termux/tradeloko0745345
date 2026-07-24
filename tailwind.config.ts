import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0a0c10",
        panel: "#0f1117",
        edge: "#1a1f2e",
      },
    },
  },
  plugins: [],
};

export default config;

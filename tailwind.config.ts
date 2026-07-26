import type { Config } from "tailwindcss";

// Every colour is a CSS variable defined in src/app/globals.css, so the admin
// accent-colour setting can override the whole palette at runtime by injecting
// a single inline style on <html> (see src/app/layout.tsx).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--c-base)",
        panel: "var(--c-panel)",
        panel2: "var(--c-panel-2)",
        edge: "var(--c-edge)",
        edge2: "var(--c-edge-2)",
        ink: "var(--c-ink)",
        mute: "var(--c-mute)",
        faint: "var(--c-faint)",
        accent: "var(--c-accent)",
        accentSoft: "var(--c-accent-soft)",
        up: "var(--c-up)",
        down: "var(--c-down)",
        warn: "var(--c-warn)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        card: "10px",
      },
      boxShadow: {
        pop: "0 10px 30px rgba(0, 0, 0, 0.45)",
        glow: "0 0 0 1px var(--c-accent-soft)",
      },
      keyframes: {
        flashUp: {
          "0%": { backgroundColor: "rgba(22, 199, 132, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        flashDown: {
          "0%": { backgroundColor: "rgba(234, 57, 67, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        flashUp: "flashUp 700ms ease-out",
        flashDown: "flashDown 700ms ease-out",
        shimmer: "shimmer 1.4s infinite",
      },
      maxWidth: {
        screen2xl: "1600px",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

/** Theme tokens are CSS variables (src/app/globals.css) so light and dark modes swap in one place. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        sunken: token("sunken"),
        line: token("line"),
        ink: { DEFAULT: token("ink"), soft: token("ink-soft"), faint: token("ink-faint") },
        primary: { DEFAULT: token("primary"), hover: token("primary-hover"), ink: token("primary-ink") },
        leaf: { DEFAULT: token("leaf"), soft: token("leaf-soft"), ink: token("leaf-ink") },
        gold: { DEFAULT: token("gold"), soft: token("gold-soft"), ink: token("gold-ink") },
        danger: token("danger"),
        // Fixed brand scale (logo greens) for surfaces that are not themed, such as the admin.
        brand: {
          50: "#f1f7ec", 100: "#e1efd6", 200: "#c4e0ad", 300: "#9ccb74", 400: "#7fb93f",
          500: "#66a218", 600: "#4f8a14", 700: "#06542a", 800: "#0b4628", 900: "#123c2a", 950: "#0a2418",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "1.25rem" },
      boxShadow: {
        lift: "0 1px 2px rgb(var(--shadow) / 0.06), 0 12px 32px -12px rgb(var(--shadow) / 0.22)",
        float: "0 24px 60px -20px rgb(var(--shadow) / 0.35)",
      },
      maxWidth: { shop: "1320px" },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
        bump: { "0%,100%": { transform: "scale(1)" }, "40%": { transform: "scale(1.25)" } },
        slidein: { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
      },
      animation: {
        rise: "rise .7s cubic-bezier(.16,1,.3,1) both",
        bump: "bump .45s cubic-bezier(.16,1,.3,1)",
        slidein: "slidein .35s cubic-bezier(.16,1,.3,1)",
      },
    },
  },
  plugins: [],
};
export default config;

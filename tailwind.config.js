// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  // ✅ Enables class-based dark mode (controlled by ThemeProvider)
  darkMode: "class",

  // ✅ Make sure Tailwind scans all relevant files
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],

  theme: {
    extend: {
      container: {
        center: true,
        padding: "1rem",
        screens: {
          sm: "640px",
          md: "768px",
          lg: "1024px",
          xl: "1280px",
          "2xl": "1400px",
        },
      },
      borderRadius: {
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.25)",
      },
      colors: {
        // ✅ Your brand palette remains intact
        brand: {
          50: "#e7f8f1",
          100: "#c4efde",
          200: "#9fe5c8",
          300: "#77dbb1",
          400: "#4fd099",
          500: "#2ab881", // primary accent (emerald-ish)
          600: "#1f9669",
          700: "#167352",
          800: "#0d5039",
          900: "#073224",
        },
      },
    },
  },

  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  // Preflight OFF on purpose: the existing app is built with inline styles over
  // default browser styling. Preflight is Tailwind's global CSS reset — leaving
  // it on would restyle every existing screen. With it off, Tailwind utilities
  // are available for new components without touching anything already built.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

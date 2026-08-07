import { useState, useEffect } from "react";

// Single source of truth for responsive breakpoints. Because the whole app is
// inline-styled (CSS media queries can't override inline styles), components
// read this hook and switch styles in JS. Re-renders on window resize /
// orientation change.
//   mobile  : < 768px   → sidebar becomes an off-canvas drawer, 1–2 col grids
//   tablet  : 768–1023  → sidebar stays, grids reflow to 2–3 up
//   desktop : ≥ 1024px  → full layout
export const BREAKPOINTS = { mobile: 768, tablet: 1024 };

export function useViewport() {
  const read = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
  const [width, setWidth] = useState(read);

  useEffect(() => {
    const onResize = () => setWidth(read());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return {
    width,
    isMobile: width < BREAKPOINTS.mobile,
    isTablet: width >= BREAKPOINTS.mobile && width < BREAKPOINTS.tablet,
    isDesktop: width >= BREAKPOINTS.tablet,
  };
}

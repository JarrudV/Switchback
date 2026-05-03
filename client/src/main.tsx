import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const standaloneMedia = window.matchMedia("(display-mode: standalone)");
const applyStandaloneClass = () => {
  const isStandalone = standaloneMedia.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  document.documentElement.classList.toggle("is-standalone", isStandalone);
};

applyStandaloneClass();
standaloneMedia.addEventListener?.("change", applyStandaloneClass);

createRoot(rootElement).render(<App />);

requestAnimationFrame(() => {
  rootElement.style.opacity = "1";
  const splash = document.getElementById("app-splash");
  if (!splash) return;

  splash.classList.add("hidden");
  window.setTimeout(() => splash.remove(), 260);
});

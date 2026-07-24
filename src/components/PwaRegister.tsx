"use client";
// Registers the service worker so the app is installable on mobile (feature #10).
// Drop <PwaRegister /> once in app/layout.tsx (inside <body>).
import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignore registration failures */
      });
    }
  }, []);
  return null;
}

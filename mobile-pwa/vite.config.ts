import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Phase 5 spike. Served from anywhere static (dev: localhost:5174;
// later: relay's static-files dir). `base: "./"` keeps asset URLs
// relative so the bundle is path-agnostic.
export default defineConfig({
  base: "./",
  server: {
    port: 5174,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-512-maskable.png",
        "icons/icon-192.svg",
        "icons/icon-512.svg",
      ],
      workbox: {
        // Take control on first load after an update so testers don't
        // have to fully close + reopen the PWA to pick up new builds.
        skipWaiting: true,
        clientsClaim: true,
        // Pairing + audit endpoints MUST always hit the network. Caching
        // a /pair/claim response would let an old pairing-code redemption
        // replay; caching /audit posts would mask delivery failures.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/pair/"),
            handler: "NetworkOnly",
            method: "GET",
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/pair/"),
            handler: "NetworkOnly",
            method: "POST",
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/audit/"),
            handler: "NetworkOnly",
            method: "GET",
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/audit/"),
            handler: "NetworkOnly",
            method: "POST",
          },
        ],
      },
      manifest: {
        name: "ORGII Mobile",
        short_name: "ORGII",
        description: "ORGII mobile remote-control client (spike).",
        display: "standalone",
        theme_color: "#000000",
        background_color: "#ffffff",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          // SVG fallback for browsers that prefer scalable assets.
          {
            src: "icons/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
});

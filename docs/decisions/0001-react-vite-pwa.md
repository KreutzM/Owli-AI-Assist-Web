# ADR 0001: React, TypeScript, and Vite for the PWA

Status: accepted for starter.

React offers a mature accessible component/testing ecosystem. Vite produces a static Cloudflare Pages artifact with fast local feedback. TypeScript strict mode and Zod keep browser/backend boundaries explicit. The project avoids SSR because the camera workflow is client-side and the marketing/SEO site already lives in a separate Astro repository.

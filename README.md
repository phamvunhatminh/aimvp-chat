# aimvp-chat

A fast, mobile-friendly AI chat app at [chat.aimvp.app](https://chat.aimvp.app). Chat with hundreds of models using
**your own API keys** for [OpenRouter](https://openrouter.ai), OpenAI, Anthropic and Google Gemini. Your keys and
your chats never touch an aimvp server.

## Features

- Four providers, one key each: OpenRouter (hundreds of models, `openrouter/auto` by default), OpenAI,
  Anthropic and Google Gemini
- Model picker in the message box, grouped by provider, with search, OpenRouter pricing and favorites
- New chats start with the message box in the middle and a few suggestions; the sidebar can be hidden on wide
  screens
- Streaming replies with stop, regenerate, edit-and-resend, and "thinking" output for reasoning models
- Markdown, tables and syntax-highlighted code with copy and download buttons
- Attach images, PDFs, Word, Excel and text/code files (paste, drop or pick); PDFs go natively to Claude and
  Gemini, as extracted text elsewhere
- Image generation with image models (OpenRouter, OpenAI gpt-image/DALL·E, Gemini image models)
- Web search per chat, with cited sources (each provider's own search tool)
- Voice input (browser speech recognition or OpenAI transcription) and read aloud (browser voices or OpenAI TTS)
- Prompt library: save prompts and insert them with `/` in the composer; `{{blanks}}` are selected to fill in
- Chat history and projects stored in the browser (IndexedDB), with rename, delete, and JSON export/import
- Search across chat titles and message text, ignoring accents ("ha noi" finds "Hà Nội"), jumping to the match
- Projects: folders for chats with shared instructions and files, created in one step from the sidebar
- Download a chat as Markdown, or print / save it as PDF
- Usage dashboard: spend (exact for OpenRouter, estimated otherwise), tokens, speed, per day / provider / model /
  project / chat, a monthly budget, and an optional summary in the sidebar
- System prompt per chat, plus a default for new chats
- "Connect OpenRouter" sign-in (OAuth PKCE), or paste any provider's key
- Light/dark theme, installable PWA, works well on phones

## Architecture

```
Browser (React SPA)
 ├─ IndexedDB (Dexie)    projects, conversations, messages, file blobs, saved prompts
 ├─ localStorage         settings + the user's API keys
 └─ streaming requests ─┬─► openrouter.ai                       (Chat Completions)
                        ├─► api.openai.com                      (Chat Completions)
                        ├─► api.anthropic.com                   (Messages API, official SDK)
                        └─► generativelanguage.googleapis.com   (Gemini streamGenerateContent)
Cloudflare Workers       serves the static build only (no backend yet)
```

Requests go straight from the browser to the provider, so there is no proxy to run, pay for, or trust. Models
are referenced as `provider:model-id` (e.g. `anthropic:claude-opus-5-5`). Every
record has a client-generated UUID, `updatedAt` and a `deletedAt` tombstone, so the data can later sync to a
server (e.g. Cloudflare D1) without a schema rewrite.

| Path                       | What lives there                                       |
| -------------------------- | ------------------------------------------------------ |
| `src/lib/providers/`       | One client per provider: models, keys, streaming, errors |
| `src/lib/sse.ts`           | Server-Sent Events parser                              |
| `src/lib/oauth.ts`         | OpenRouter OAuth PKCE flow                             |
| `src/lib/db.ts`, `repo.ts` | IndexedDB schema and all reads/writes                  |
| `src/lib/chat.ts`          | Send / stream / stop / regenerate / edit orchestration |
| `src/lib/files.ts`         | Reading attachments: image downscaling, PDF/Word/Excel text |
| `src/lib/speech.ts`, `read-aloud.ts` | Voice input and read-aloud helpers           |
| `src/lib/search.ts`        | Accent-insensitive matching for chat search            |
| `src/lib/usage.ts`, `pricing.ts` | Usage stats and cost estimates                   |
| `src/stores/`              | Zustand stores: settings, model catalog, UI, streams   |
| `src/components/`          | UI (shadcn-style components on Radix + Tailwind v4)    |
| `public/_headers`          | Security headers (CSP etc.) served by Cloudflare       |

**Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, Radix UI, cmdk, Dexie, Zustand, react-markdown,
vite-plugin-pwa, Vitest, Playwright, Wrangler.

## Development

Requires Node 22+.

```sh
npm install
npm run dev          # http://localhost:3000
```

The dev server is pinned to port 3000 because OpenRouter only accepts `localhost` OAuth callbacks on that port.

| Script                       | Does                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `npm run lint`               | oxlint                                                            |
| `npm run typecheck`          | TypeScript project build                                          |
| `npm test`                   | Unit tests (Vitest, fake IndexedDB)                               |
| `npm run test:e2e`           | Browser tests (Playwright) against the production build, mocked API |
| `npm run build`              | Production build to `dist/`                                       |
| `npm run cf:dev`             | Build and serve with the real Cloudflare runtime and headers      |
| `npm run deploy`             | Build and deploy with Wrangler                                    |

First run of the e2e tests on a new machine: `npx playwright install chromium`.

## Deploying to Cloudflare

1. Add the `aimvp.app` zone to your Cloudflare account. `wrangler.jsonc` attaches `chat.aimvp.app` as the
   Worker's custom domain. Each deploy replaces the Worker's custom domains with that list, so change domains
   there rather than in the dashboard.
2. Pick one:
   - **Git integration (recommended):** Cloudflare dashboard → Workers & Pages → Create → Import a repository →
     select this repo. Build command `npm run build`, deploy command `npx wrangler deploy`. Every push to `main`
     deploys, and other branches get preview URLs.
   - **From your machine:** `npx wrangler login`, then `npm run deploy`.

No secrets or environment variables are needed: the app holds no keys of its own.

## Security model

- Keys are the user's own, stored in `localStorage`, and each is sent only to its provider. Keys from
  "Connect OpenRouter" can be capped or revoked by the user at openrouter.ai/settings/keys.
- The main risk to a browser-held key is XSS, so: a strict CSP (`connect-src` allows only the four provider
  APIs), no third-party scripts or analytics, model output rendered without raw HTML, and remote images in model output
  shown as links (never fetched, so a prompt injection can't leak the chat through an image URL). Web search sources
  are kept only if they are http(s) links.
- Files are read in the browser and sent only to the chosen model's provider. The microphone is allowed for this
  origin only (`Permissions-Policy`), and only while the mic button is on.
- Browser speech recognition (Chrome, Edge, Safari) is run by the browser vendor's speech service; pick OpenAI in
  Settings → Voice to keep speech with your own key instead.
- Cost estimates for OpenAI, Anthropic and Gemini use OpenRouter's public model list, fetched without any key.
- Chats live in the browser. The app asks for persistent storage; installing it as a PWA and exporting
  backups protects history from browser eviction (notably Safari).

## Roadmap

- Accounts and multi-device sync (Cloudflare D1, reusing the current schema)
- Large document collections with retrieval (R2 + Vectorize)
- Sharing conversations

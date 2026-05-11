# Whitestone Partners — Marketing Site Working Reference

This file is a grounding document for any AI tool (Cursor, Claude Code, Claude.ai chat) working on this repo. Read it before touching code.

> **Workspace context:** the dealer portal lives in a separate GitHub repo, `WhiteStone-Partners-BSC/Whitestone-Dealer-Portal`, locally at `~/Desktop/Whitestone-Dealer-Portal/`. Anything authenticated, transactional, or data-bearing belongs in THAT repo. This repo is the public marketing site only — static HTML, no backend, no Supabase, no Stripe.

---

## 1. What this repo is

The public-facing marketing site for **Whitestone Partners LLC**, a marine prepaid-maintenance program. Live deployment: `whitestone-partners.com`. Single goal of this site: attract marine dealers and convert them into completing the partner application form. There is no customer-facing flow on this site — customer enrollment happens through dealers via the dealer portal.

## 2. Stack

- **Frontend:** vanilla HTML, CSS, and JavaScript inside a single `index.html` file. No framework. No build step. No bundler.
- **Hosting:** Vercel. Auto-deploys from `main` branch.
- **Forms:** Formspree (partner application + contact). Form IDs are hardcoded in `index.html`:
  - `mlgonaae` — partner application (dealer recruitment form)
  - `mvzvzkqa` — contact form
- **Video hosting:** four `.mp4` files committed to git in this repo (videos 1–4). Should probably be moved to Cloudinary in the future (the dealer portal uses Cloudinary already) — videos in git add ~3 MB of repo weight per file.
- **Image hosting:** `image.jpg` in repo root.

## 3. File map

- **`index.html`** — the entire site. Hero, intro animation, video sections, modal forms (partner + contact), success states. Single-page, single-file.
- **`image.jpg`** — hero image.
- **`video1.mp4` through `video4.mp4`** — section videos.
- **`video_test.html`** — appears to be a standalone test page for video playback. Not part of the live site. Could potentially be removed in a cleanup pass.
- **`Vercel.json`** — Vercel rewrite config. **WARNING:** filename starts with capital `V`. Vercel runs on Linux which is case-sensitive — this file may be ignored at deploy time. Should be renamed to lowercase `vercel.json` in a future cleanup. Content: SPA rewrite rule.

## 4. Critical invariants

These rules must never be violated:

- **No backend code in this repo.** No `/api/` folder. No serverless functions. No environment variables for backend services.
- **No Supabase client.** Do not import `@supabase/supabase-js`. The marketing site does not read or write the database directly.
- **No Stripe.** No payment flows here. No `pk_live_...` keys.
- **Form submissions go through Formspree only.** Do not write custom form handlers that POST to the dealer portal or to Supabase. Formspree handles routing the submissions to email and to the `dealer_applications` Supabase table (the table itself lives in the dealer portal's Supabase project — but it's populated via Formspree's webhook, not direct write from this site).

## 5. Known issues (from prior audits)

1. **`Vercel.json` casing.** Capital V will likely be ignored on Vercel's Linux build environment. Rename to lowercase `vercel.json`.
2. **No SEO / Open Graph / Twitter meta tags.** `index.html` has only `<meta charset>` and `<meta name="viewport">`. Missing:
   - `<meta name="description">`
   - `<meta property="og:title">`, `og:description`, `og:image`, `og:url`
   - `<meta name="twitter:card">`, twitter:title, etc.
   - Favicon link
   - Canonical URL
   - This means every time someone shares the URL on LinkedIn, iMessage, or Slack, the preview looks broken. Direct conversion impact for a dealer-recruitment site.
3. **`.DS_Store` committed in git.** macOS metadata, should be `.gitignore`'d.
4. **Large videos committed to git.** Four `.mp4` files, ~3 MB each. Bloats the repo. Should be moved to Cloudinary (which the dealer portal already uses) and referenced by URL.
5. **`video_test.html` may be dead code.** Confirm it's not linked from anywhere in `index.html`, then delete.

## 6. What belongs here vs. the dealer portal

- **Here:** marketing copy, hero, value props, dealer recruitment form, contact form, public-facing videos, anything a logged-out visitor can see.
- **Dealer portal (separate repo):** anything behind login. Dealer enrollment in the application sense (post-recruitment) happens in the dealer portal admin panel where the `dealer_applications` row gets reviewed and approved.

If something needs Supabase, Stripe, or a logged-in user — it goes in the dealer portal, not here.

## 7. Working with this repo

- **Editor:** Cursor (user's primary tool).
- **Commit before starting work and after each logical change.**
- **Direct push to `main`** triggers Vercel auto-deploy. There is no staging environment for this site — what's on `main` is what's live.
- **No tests.** No CI. Manual review only.

## 8. Change log

### 2026-05-11 — CLAUDE.md added
First commit of CLAUDE.md to this repo. Created during workspace cleanup that consolidated all working copies onto Desktop and deleted disconnected snapshots in `~/Documents/`. The dealer portal's CLAUDE.md (committed earlier on 2026-05-11) contains companion context for that repo.

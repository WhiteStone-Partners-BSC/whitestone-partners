# Whitestone Partners — Marketing Site

Grounding document for Claude Code sessions in this repo. **Read this fully before touching anything.**

Repo: `WhiteStone-Partners-BSC/whitestone-partners`
Local: `/Users/benjaminlloyd/Desktop/WhiteStone Landing Page`
Live: `https://www.whitestone-partners.com`

---

## 1. What this repo is — and is not

This is the **public marketing site**. Static HTML, CSS, and vanilla JS. No build step, no bundler,
no framework, no package.json worth speaking of.

**It is NOT:**
- the dealer portal (that is a separate repo, `Whitestone-Dealer-Portal`, deployed to
  `whitestone-dealer-portal.vercel.app`)
- a place for Supabase clients, auth, transactional logic, or anything data-bearing
- a place for an `/api/` folder

**If a session finds itself wanting to add a backend here, stop and ask.** That is a signal the work
belongs in the portal repo.

The two repos are **not siblings on disk**. Do not assume relative paths between them work.

---

## 2. The business, in one paragraph

Whitestone Partners LLC sells **prepaid marine maintenance contracts** to boat dealers on a
dealer-first wholesale model. The dealer buys wholesale, sets their own retail price, keeps the F&I
margin, and gets reimbursed at their own labor rate when covered work is performed. The pitch is
**"you get paid twice"** — profit on the contract, profit on every service. Ten covered services on
manufacturer intervals. Sold at the F&I desk and at the service counter.

**Audience for this site:** a dealer principal, GM, or F&I manager at an inboard towboat dealership
(MasterCraft, Malibu, Nautique, Tigé, Supra, Centurion). They are evaluating whether Whitestone is a
real company worth a phone call. They are not consumers. **The job of this site is credibility and a
booked conversation, not a transaction.**

---

## 3. Files

| File | What it is |
|---|---|
| `index.html` | Homepage |
| `become-a-dealer.html` | **The main conversion page.** ~774 lines. Cinematic intro → hero → video → territory map → what we offer → margin → enrollment form → signature |
| `dealer.html` | Personalized QR landing page. Reads `?dealer=X&name=Y` from the box campaign |
| `partner-preview.html` | Separate demo page, routed at `/partner-preview` |
| `demo.html` | Scratch/demo file |
| `vercel.json` | Routes `/become-a-dealer` → `become-a-dealer.html`, `/partner-preview` → `partner-preview.html` |

CSS is **inline in each file**, inside a single `<style>` block. There is no shared stylesheet.
Each page is self-contained by design — keep it that way unless explicitly asked otherwise.

There are numerous `.bak-*` and `index-backup-*` files in the working tree. **They are untracked and
must never be staged.** Same for `.DS_Store` files.

---

## 4. Design language

This is an established aesthetic. Do not replace it wholesale without being asked.

```
--navy:       #0c1e2e
--navy2:      #12304d
--navy-deep:  #081422
--navy-soft:  #4a6278
--gold:       #b8963e
--gold-light: #d4b872
--paper:      #f4f1ea
```

- **Serif display type** with *italic gold emphasis* for headline accents (`<em>` inside `.section-title`)
- Eyebrow labels: 11px, `letter-spacing:0.32em`, uppercase, gold
- Alternating band backgrounds: navy → paper → navy-deep
- Icons: inline SVG, 24×24, `stroke-width:1.5`, `stroke="currentColor"`, no fill
- The overall register is **premium and restrained** — it matches the physical campaign (matte-black
  boxes, Maui Jim sunglasses, personalized QR cards). It should read like a serious financial
  partner, not a consumer brand.

---

## 5. Do not touch without being asked

These are load-bearing and easy to break silently:

1. **The cinematic intro overlay** — `#intro-overlay`, `.intro-stage-1/2`, the `logoFadeIn` /
   `stage1Cycle` / `stage2Cycle` keyframes, and the `URLSearchParams` logic reading `dealer=` and
   `name=`. This drives the personalized pages that real dealers reach by scanning a QR code on a
   physical box. Breaking it breaks the campaign.
2. **The video block** — `#video`, `/assets/video/whitestone-explainer.mp4` and its poster.
3. **The enrollment form** — `#enroll-section`, `#enrollForm`, `submitEnrollment`. See the open
   question in Section 8 before changing anything here.
4. **The territory map** — `#territory` section in `become-a-dealer.html`. See Section 6.

---

## 6. The territory map

`become-a-dealer.html` contains an inline SVG US map creating founding-dealer scarcity. Real Census
boundaries, Albers USA projection, ~25KB of path data, no library.

**The scarcity must stay truthful.** Only genuinely claimed states get marked. Today that is Idaho
(Hagadone Marine) alone. Utah was deliberately removed because Lake City Marine is a test org, not a
real dealer relationship. A dealer who catches an inflated land-grab will not trust anything else on
the page.

To update when a dealer signs, edit one line near the bottom of the file:

```js
var WS_CLAIMED = ['ID'];
```

Map shading, both counters, and the legend names all derive from that array. `WS_FOUNDING_SLOTS`
controls the total.

---

## 7. Git and deployment rules

**You may run git commands, including commit and push.** Two rules remain absolute:

- **Never run `git add -A`.** Stage named files only. The working tree contains untracked backups
  (`.bak-*`, `index-backup-*`), `.DS_Store` files, and a large unoptimized PNG that must never be
  committed. This is not about caution — it is about what is actually sitting in the directory.
- **Never force-push, never rewrite history, never `git reset --hard` on shared branches.**

Preferred workflow for anything visual or non-trivial:

1. Branch: `git checkout -b <short-descriptive-name>`
2. Make the change, `.bak` first, verify by grep
3. Stage named files, commit with a clear message
4. Push the branch
5. **Report the Vercel preview URL** so Ben can look at it before it reaches production
6. Merge to `main` only when Ben says so

Small, obvious, low-risk fixes (a typo, a broken link) may go straight to `main`.

Still true:
- Always `cp file file.bak-<name>` before editing an existing file.
- `git diff <file> | grep "^-"` after every edit. Unexpected deletions mean something was
  overwritten rather than inserted — stop and report.
- Match anchors by string, not line number. Line numbers shift after any insertion above them.
- Vercel auto-deploys from GitHub pushes. **A push to `main` is live to real dealers immediately.**
- `www` is canonical for this domain; the apex 307-redirects. The portal repo is the opposite —
  `*.vercel.app` wildcard certs cover the apex only. Do not confuse the two.

**This applies to the marketing repo only.** The dealer portal — money, auth, RLS — stays on the
manual-push workflow.

---

## 8. Known issues and open questions

- **`/api/submit-enrollment` — UNRESOLVED AND IMPORTANT.** `become-a-dealer.html` posts the
  enrollment form to `/api/submit-enrollment`, but this repo has no `api/` folder. Either a Vercel
  rewrite points it at the portal, or **the form is silently failing.** This has never been
  confirmed end-to-end. Dealers have landed on this page and not converted. Verify before doing any
  conversion work — a design improvement cannot fix a dead endpoint.
- Formspree endpoints in use elsewhere on the site: `mvzvzkqa` (contact), `mlgonaae`
  (registrations).
- An ~8MB unoptimized source PNG sits in `assets/img/` uncommitted.
- **Privacy Policy and Terms of Service do not exist.** `/privacy` returns 404, and Stripe
  references it from the portal. Real gap.

---

## 9. Hard-won lessons

- **The `background` CSS shorthand wipes `background-image`.** Use `background-color` when a
  background image must survive. This cost hours when a hero photo stayed navy despite correct code.
- **`!important` beats inline styles.** Relevant when overriding inline `style=` attributes.
- **Pushed ≠ done.** Confirm the live site, not just the local file. `curl` the deployed URL and
  grep for the change.
- The site is served from `www`. Testing the apex will follow a 307 — that is expected, not a bug.
- Opening a file directly with `open file.html` works for layout checks, but absolute asset paths
  (`/assets/video/...`) will not resolve. Use `python3 -m http.server 8000` when assets matter.

---

## 10. How to work here

- **One concern per session.** Do not mix a design change with a copy change with a routing change.
- **Read before writing.** Grep the actual file. Several times work has been scoped that already
  existed in the codebase.
- **Show visual mockups before building UI.** Ben prefers to react to something rendered rather than
  approve a description.
- **Honest pushback is wanted.** If a request would overbuild, or if the real blocker is elsewhere,
  say so plainly. The standing strategic insight is that the constraint is *sales and real dealer
  usage*, not missing features.
- **Ben does not write code directly.** He reviews and approves; Claude runs the git commands (see
  Section 7). Explain the reasoning in plain language before the diff.
- **Node is installed** (v26.7.0), so `npm`/`npx` work. The Stripe CLI and the Supabase CLI are both
  installed; Homebrew is available.

---

## 11. Context worth having

**Current commercial reality (Aug 2026):** No dealer has signed yet. Warmest leads are Carly Grove
at Hagadone Marine (intent to proceed, pending her service manager) and Kip at Fred's Marine (came
back inbound). Both have said they want to talk **after the season**. A newsletter plug went out to
400+ dealers via an industry contact.

**What the data says about this site:** Several dealers scanned their physical box QR codes and
landed on the personalized pages — Seattle Boat Company six times across a month, Taylor's Boats and
Hagadone both returning in late July. **None of them filled out the enrollment form.** That is the
central conversion problem this site has, and it is the thing worth optimizing against.

Carson Nielsen (CEO) must **never** appear by name in any public-facing page, UI, or email.

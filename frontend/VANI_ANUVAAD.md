# Vani Anuvaad

A Voice AI package design, configuration and quoting product. It lives beside the other VoicERA work as its own route tree, `/vani/**`, with its own styles and no changes to any existing page.

Start the dev server and open `http://localhost:3000/vani`.

## What is real and what is sample

- Everything you see is wired: sign-up, email verification, sign-in, sessions, the five-step workflow, saved drafts, versions, policy checks, approval and agent set-up all work end to end.
- The "backend" is a mock that runs in the browser (`src/lib/vani/api.ts`), storing data in `localStorage` under `vani.db.v1`. Nothing leaves the browser. No email is sent; a clearly labelled "Prototype inbox" button stands in for the link in the email.
- Provider names are real. **Every model, rate, benchmark and test-call count is a sample figure** and is labelled "Sample catalogue" in the product. Do not treat any price as an offer.
- All accounts, organisations and packages are fake. Do not enter real citizen data.

## Demo accounts

Created on first load, in the organisation "Directorate of Citizen Services (sample)". They share one password, recorded in `src/lib/vani/seed.ts` (`DEMO_PASSWORD`): `Vani-demo-2026!`

| Role | Email |
|---|---|
| Admin | asha.verma@sample.example |
| Product manager | rohan.iyer@sample.example |
| Operations | meera.nair@sample.example |
| Reviewer | karan.bose@sample.example |
| Viewer | divya.rao@sample.example |

The sign-in page also has a "Prototype demo accounts" box that fills the form for any role. A sample package, "Citizen Support Helpline" (Hindi and English, 50,000 calls a month, 3 minutes, peak 40, ₹90,000 budget), is already in the workspace.

Creating a new account makes a new organisation (you are its admin). Using an existing organisation's name joins it as a Viewer.

## Routes

| Route | What it is |
|---|---|
| `/vani` | Landing page with the animated pipeline |
| `/vani/signin`, `/signup`, `/forgot`, `/reset`, `/verify` | Authentication |
| `/vani/app` | Overview |
| `/vani/app/packages` | Package list (filter, duplicate, archive) |
| `/vani/app/packages/new` | Start a package |
| `/vani/app/packages/[id]/requirements` | Step 1, with the live estimate |
| `/vani/app/packages/[id]/hosting` | Step 2, hosting, data governance, PII, privacy pipeline, policy checks |
| `/vani/app/packages/[id]/recommendation` | Step 3, fit, reasons, stack, alternatives, comparison, exclusions |
| `/vani/app/packages/[id]/configure` | Step 4, layers, usage, cost, budget meter, composition, versions |
| `/vani/app/packages/[id]/quote` | Step 5, the quote, export, approval |
| `/vani/app/agents` | Agents created from approved quotes |
| `/vani/app/insights`, `/governance`, `/settings`, `/help` | Cost charts, audit log and role matrix, settings, help |
| `/vani/app/design` | The design system |

## How it works

- `src/lib/vani/recommend.ts`: hard rules first (hosting, in-country data, language, channel, capacity, provider availability), then a weighted score by what the adopter said matters. Fit is shown with its parts. Confidence is fit, discounted for unanswered inputs and open items.
- `pricing.ts`: each cost line is rate × usage. Hosting is a fixed monthly profile. Setup is one-time. Budget over 100% blocks submission.
- `policy.ts`: checks return PASS, CHECK or OPEN, each with what, why and how. A check clears by fixing its cause or by accepting it with a written reason, which is written to the audit log.
- `rbac.ts`: Admin, Product manager, Operations, Reviewer, Viewer. Enforced in the API, not only in the UI. Disabled controls say who can do the thing.
- `api.ts`: adds latency, sessions (8 hours, or 30 days with "Keep me signed in"), lockout after five failed sign-ins, tokens, audit log, notifications, and the failure switches below.
- Quotes: `Q-0001` and up, valid 30 days. Draft, Submitted, Approved. Once submitted the package is locked until the quote is returned or reopened. Real PDF (jsPDF) and CSV downloads.

## Prototype tools (Settings, admin only)

Network down, recommendation service down, pricing unavailable, PDF creation fails, prices changed since quoting, one provider unavailable, expire my session now, reset all demo data. Sign-in is deliberately exempt from the simulated outage so you can always get back to these switches.

## Tests

```bash
npx tsc -p tsconfig.vani-test.json && node --test .vani-test/tests/*.test.js
rm -rf .vani-test
```

They cover the recommendation rules, pricing, policy checks, roles, sign-up, sign-in, lockout, expiry, reset, the full journey to an approved quote and agent, organisation separation, and the quote, CSV and PDF.

## Not included

- A real backend, real email, or real telephony.
- Campaign scheduling and call lists. Agents stop at the set-up checklist.
- The PDF uses "Rs" rather than the rupee sign, because its built-in fonts have no rupee glyph.

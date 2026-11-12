# VoicERA Package Builder

Open: http://localhost:3000/builder (run `npm run dev` in this folder).

An entirely new system, in its own route, with its own design. **No existing file was changed**: `/adopt`, `/canvas`, `/compose`, `/studio` and the advisor are as they were.

## What it is

For a government adopter who has many use cases and does not know which package to take. Six stages:

1. **Discover**: a conversation. Adaptive questions with tappable options (sector, use cases, who calls whom, volume, call length, languages, systems, handover, content, data sensitivity, hosting, telephony, models, timeline, budget). The adopter can type their own question at any time and it is answered from the documents; anything the documents do not answer goes on a list for the VoicERA team. A **pitch writes itself** beside the chat and grows with every answer.
2. **Package**: the recommendation (Deploy, Connect or Orchestrate) with the rules that led to it, a "start here, grow to there" path, the three packages, a Custom option, and a capability comparison.
3. **Canvas**: the call pipeline as nodes: telephony, listens (STT/ASR), thinks (LLM), speaks (TTS), knowledge (RAG), acts in your systems, hands over, watches, where it runs. Each node opens a drawer with the options, what each costs, and a plain-words reason to choose it for the adopter's use case. Change any layer and the label updates: Deploy, Connect, Orchestrate, or "Connect plus 2 from Orchestrate".
4. **Cost**, in three tabs:
   - **Summary**: the live total against a budget, the price in three parts (one-time, usage, ongoing), a donut, what each choice costs, and items not priced yet with a place for the adopter's own figure.
   - **Itemised quote**: the cost laid out as a real quotation. Every row has a quantity, a rate, an amount and a status (priced, your figure, or not priced yet). Rows with no price stay in their section as "To be quoted", never as zero. It also shows unit economics (per call, per 1,000, monthly run rate), what the usage price covers, what is included at no separate charge, and a volume ladder. Print or save as PDF, spreadsheet (.csv) or document (.md).
   - **If you grow**: what each step up adds, asks, and does to the price.
5. **Deploy**: the execution model: who does each step (you, VoicERA, your IT), what each delivers, what is documented and what depends on your approvals, what you bring, checks before launch, and a downloadable hand-over pack (10 files, zip).
6. **Pitch**: the elevated pitch, end to end, as a deck of 13 slides built from the adopter's own answers and canvas: the cover, the need, what VoicERA is, what citizens will hear (an illustrative sample conversation), how a call flows, why each choice was made in plain words, what you get, your package, the investment, how you grow, how it goes live, what we need from you, and the next step. **Present** one slide at a time (arrow keys, full screen) or **Read all**. **Presenter notes** tell whoever is delivering it how to give each slide. Print or save as PDF, download as .md, or copy.

A light and dark theme toggle is in the header. The choice is remembered and applied before the page paints. Printing is always light.

## Prices

The package documents give three prices: setup Rs. 50,000, Rs. 500 a phone number, and a usage price. **The provider has set usage to 5 paise per call** (the document had Rs. 0.50 a minute). Everything else has no price in the documents and shows as "not set" until the provider sets one: commercial models (OpenAI, Google Chirp, Eleven Labs), models listed without detail (Sarvam, BHASHINI, Bodhan, Raya), connecting your own model or telephony provider, Connect and Orchestrate implementation, managed operations, hosting other than Bhashini.

Click **Provider view** (top right) for the price book. Every price in the builder reads from it, with a tag saying whether it came from the package document, was set by VoicERA, or is not set. Switch usage between per call and per minute there. It is saved in this browser under `voicera.builder.prices.v1`.

Bring-your-own model: the adopter enters their own provider's cost; it appears in the total labelled as theirs. VoicERA's connection fee is not defined, so it shows as open.

## What is honest about it

- Model and telephony lists are the documents' **samples**, not a final list.
- "Why choose X for grievances" text is **VoicERA guidance, not a measured result**, and says what to check. The package document defers model quality to a Voice Arena report that has not been supplied.
- Open items are said aloud: where call data is stored, whether it trains models, how long it is kept.
- Timings are typical ranges, not commitments. Only two are documented for the packaged offer: set-up in 2 working days once everything is handed over, and 24-hour troubleshooting.
- Deploy does **not** deploy anything. The VoicERA team sets it up, hosted on Bhashini. Running it on your own machine is listed in the ICP but not described in the package document, so it is marked to confirm.
- The question answering is a curated, keyword-matched set. It is not an AI model and never makes something up.
- Everything stays in this browser (`voicera.builder.v1`). Nothing is sent anywhere.

## Tests

```
npx tsc -p tsconfig.builder-test.json && node --test .builder-test/builder/tests/builder.test.js && rm -rf .builder-test
```

90 tests: catalogue and capability facts, price maths to the paisa, package classification, the recommendation rules, the question flow, question matching, the pitch, the itemised quote (every priced row is quantity x rate, open rows stay out of totals), the 13-slide deck (every slide has notes, figures match the quote, no unsourced claims), the upgrade path, the execution plan and the hand-over pack.

## Files (all new)

- `src/lib/adopt/builder/`: `catalog.ts` (facts), `canvas.ts` (selection and classification), `pricing.ts` (price book and cost), `quote.ts` (the itemised quotation), `profile.ts` (questions, recommendation), `kb.ts` (the adopter's questions), `pitch.ts` (the live pitch sheet), `deck.ts` (the 13-slide pitch), `grow.ts`, `deploy.ts`, `pack.ts`, `store.tsx`, `tests/`
- `src/components/builder/`: `BuilderApp`, `Discover`, `Packages`, `CanvasStage`, `CostStage`, `QuoteView`, `DeployStage`, `PitchStage`, `ProviderPanel`, `ThemeToggle`, `parts`
- `src/app/builder/`: `layout.tsx`, `page.tsx`, `builder.css` (its own visual system, scoped to `.vb`)
- `tsconfig.builder-test.json`

## Notes for whoever maintains it

- `builder.css` sits inside Tailwind's `components` layer, so Tailwind utilities (such as `hidden`) override it as expected.
- The app's global stylesheet has a print rule that hides everything except one class. `builder.css` overrides it inside `.vb` only, so the quote and the deck print. Nothing outside the builder was changed.
- The theme lives on the html element as `data-vb-theme` and is set by a tiny inline script in `layout.tsx` before first paint. Key: `voicera.builder.theme`.

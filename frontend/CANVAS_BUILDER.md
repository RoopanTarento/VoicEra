# VoicERA Canvas (budget-first package builder)

Open: http://localhost:3000/canvas (run `npm run dev` in this folder).

A new, separate part of the adopter experience. **No existing file was changed.** It reuses the existing rule engine,
cost engine, sample conversations and zip writer.

## The flow

Six screens, one idea each. The first three are a guided pitch, the last three are the builder.

1. **What we offer** (four short panels): what VoicERA is, what you get, how it works with a diagram, and what it costs, including what it does not cover and what is still to be confirmed. Every figure is read from the package document constants.
2. **About you** (four questions): what to build, how many calls, how long a call is, and the budget. Each answer is a planning figure and "not sure yet" leaves it open instead of guessing. Answers are saved, so a refresh resumes where you were.
3. **Your plan**: the pitch tailored to those answers: what citizens will experience, the call-flow diagram with your own amounts, headline numbers, "good to know" and "what you bring". Then "Build it on the canvas".
4. **Build**: your service as short rows in five sections. Tap a row for details, + Add to add, "Remove it" for anything outside the package.
5. **Cost**: one big number and a budget bar, then one picture at a time: **How it flows** (the orchestration diagram showing which charge pays for which part), **Where it goes** (donut) or **Month by month** (running total against the budget).
6. **Launch**: seven stages worked out from what you have done, hand-over pack, checks, sample call, where it runs.

## How cost works (nothing invented)

Only the three documented rates are used: ₹50,000 setup, ₹500 per number, ₹0.50 a minute for open-source models (end to end, including telephony).
Everything else is one of: included with no separate charge documented, supplied by the department, or **needs a quote**.
Needs-a-quote items are listed and never given a price. You may type your own figure; it is added to the total only as "your own figure" and labelled that way. The total is called "Known so far" until nothing is open.
The budget period (months) and volumes are your planning figures, not package terms.

## How fit works

The canvas is turned into the same answers the Advisor uses, so the verdict, limits and wording come from the same rules and cannot disagree with it.
A grievance line that only takes complaints is judged as "another use case"; as soon as it files into a complaints system it becomes complaint registration, which the package treats as needing a system link (outside the package).

## What is demo-only or open

- The sandbox is a scripted text conversation. It does not verify any model. The package document defers model quality to a Voice Arena report that has not been supplied.
- Deploy does not deploy anything. Hosting is on Bhashini, set up by the VoicEra team. Running it on your own machine is not described in the package document, so it is shown as "Not documented" with the questions to ask.
- Sign-off, hand-over and verification ticks are the person's own confirmations, stored in this browser (`voicera.canvas.v1`). Nothing is sent anywhere.
- Open items from the package document remain open: where call data is stored, whether it trains models, retention, the real model list, proprietary pricing.

## Files (all new)

- `src/lib/adopt/advisor/canvas.ts` catalogue, templates, cost and budget, verdict, stages, hand-over files
- `src/lib/adopt/advisor/canvas-store.tsx` state (own localStorage key)
- `src/lib/adopt/advisor/pitch.ts` the pitch content, the four questions and the tailored plan
- `src/lib/adopt/advisor/tests/canvas.test.ts`, `pitch.test.ts` 41 tests; run `npm run test:advisor` (134 in total)
- `src/components/canvas/*` UI (`PitchFlow` for screens 1 to 3, `FlowDiagram` for the orchestration picture, `CostViews` for the switcher); `src/app/canvas/{layout,page}.tsx` route

## The orchestration diagram

The per-minute rate in the package document is end to end, so it is drawn around the whole "VoicERA runs the call" box. The document gives no split between listening, thinking and speaking, so none is shown or invented. Setup is shown as a one-time strip, the phone number charge on the number, and anything outside the package (your own systems) as a dashed box marked "Needs a quote".

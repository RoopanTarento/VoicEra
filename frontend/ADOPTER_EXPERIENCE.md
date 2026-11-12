# VoicERA adopter experience (`/adopt`)

A working walk-through for government departments: choose a service, hear how it
would sound, compare packages, get a recommendation, then configure, test and
check readiness in a workspace. It lives inside this Next.js app at `/adopt` and
is **public** (it sits outside the `(app)` route group, so no sign-in is needed).

Source of truth for all content: *ICP - Voicera [Use Case Based] 6-Oct-26*.
Anything not in that document is labelled "Our suggestion" or "To confirm" in the UI.

## Run it

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000/adopt>. Nothing else needs to be running: the
experience uses no backend and no API keys.

Checks used while building (all clean for the files under `/adopt`):

```bash
npx tsc --noEmit -p .
npx eslint src/app/adopt src/components/adopt src/lib/adopt
npx next build --webpack
```

`npm run build` passes. Earlier in development it failed once while loading a Google font (Noto Sans Tamil, used by the sign-in page), which needs network access to Google Fonts at build time.
If you see that error again, check your connection and retry. `npx next build --webpack` is a fallback.

If you see a "tree hydrated but some attributes ... didn't match" warning on every refresh, a browser extension is adding attributes to the page. The root layout now tolerates this.
Before reporting a refresh error, stop the dev server, delete the `.next` folder, and run `npm run dev` again.

## The 11-step path (verified in a browser, desktop and 375px mobile)

1. Open `/adopt`
2. Explore a use case: `/adopt/sectors`, then a segment such as Civic & local government
3. Open an application: `/adopt/applications/grievance`
4. Compare packages: `/adopt/packages`
5. Complete the guided selection: `/adopt/select` (conditional questions, back, change any answer, answers kept)
6. Review the recommendation: `/adopt/select/result`
7. Enter the workspace: `/adopt/workspace`
8. Configure: `/adopt/workspace/configure` (validated; save is refused until required fields are right)
9. Run a test scenario: `/adopt/workspace/test`
10. Review readiness: `/adopt/workspace/readiness`
11. Open operations: `/adopt/workspace/operations` (after the deployment rehearsal, or via an explicit preview)

## Screens (20 routes)

| Area | Routes |
|---|---|
| Discover | `/adopt` |
| Sectors | `/adopt/sectors`, `/adopt/sectors/[id]` |
| Applications | `/adopt/applications`, `/adopt/applications/[id]` |
| Packages | `/adopt/packages`, `/adopt/packages/[id]` |
| Guided selection | `/adopt/select`, `/adopt/select/result` |
| Citizen view | `/adopt/citizen`, `/adopt/citizen/[id]` |
| Workspace | `/adopt/workspace` (overview), `/configure`, `/knowledge`, `/test`, `/readiness`, `/deploy`, `/operations` |
| Platform status | `/adopt/platform` |
| Help and support | `/adopt/help` |

Plus an error boundary and a not-found page for `/adopt`. A link to the experience
was added to the console sidebar ("Adopt VoicERA", `src/components/AppSidebar.tsx`).

## How it is built

- `src/lib/adopt/` holds everything that is not rendering.
  - `icp.ts`: segments, archetypes, product families, platform layers, the three packages
  - `apps/*.ts` and `applications.ts`: the five applications (journey, example conversation, knowledge, integrations, scenarios, config schema, defaults)
  - `capabilities.ts`: what the ICP says is available, next to what a repository check found
  - `questionnaire.ts`: conditional questions and `recommend()`
  - `config-schema.ts`: validation for the workspace forms
  - `simulate.ts`: the scripted conversation engine
  - `readiness.ts`, `demo-data.ts`, `state.tsx` (localStorage store)
- `src/components/adopt/`: shell, workspace pages, form renderer, conversation runner
- `src/app/adopt/`: thin route files

Shared state (answers, workspace, config, test reviews, approvals, rehearsal) lives
in this browser's `localStorage` under `voicera.adopt.v1`. Nothing is sent anywhere.
Footer link "Start over" clears it.

Design follows the existing Signal tokens (`--v-*`): warm paper, white panels, blue
accent, mono eyebrow labels. Green appears only as a status colour. No emoji.

## Recommendation logic

Application comes from the objective answer. Package starts from the ICP's pairing:
Grievance is Orchestrate; Form Filling and Application Support are Connect; Scheme
Discovery and Surveys are Deploy. Scheme Discovery and Surveys move to Connect if the
adopter wants status lookups or record writes. Dependencies are derived from answers
(API readiness, retention rules, handoff staffing, outbound calling, volume, environment)
and are graded Blocks launch / Needs a decision / Good to know. No price or date is produced.

## Completed

- Landing, sector hierarchy from the ICP, catalogue with segment filter and side-by-side table
- Five application detail pages (problem, adopter, citizen journey, example conversation, capabilities, configuration, knowledge, integrations, handoff, testing, measures, package, dependencies)
- Package comparison and detail pages from the adopter's side (who for, problem, can accomplish, must provide, configured, dependencies, included, not covered, next steps)
- Guided selection with 10 to 15 conditional questions, back, change answer, review, validation
- Recommendation with application, package, reasons, configure-now list, dependencies, team needs, alternatives, open questions, downloadable brief
- Workspace: overview, validated configuration per application, knowledge and system tracking, conversation testing with review, readiness with approvals, deployment rehearsal, operations
- Citizen phone view: language choice, text size, consent notice, repeat, person on request, stop request, emergency redirect to 112, sensitive-data refusal, unclear-answer handling
- Accessibility basics: skip link, labelled controls, focus moved to each question, live regions, keyboard-operable, table fallback for the chart
- Empty, loading, error and success states

## Demonstration only (not real)

- **Conversation tests and the citizen view** are scripted from the saved configuration. No speech, model or telephony. The language is only labelled; the text is English.
- **Operations figures** are generated from a fixed seed and shown only after the rehearsal or an explicit preview. They are labelled as demonstration data.
- **Deployment rehearsal** checks the adopter's own entries in the browser. It deploys nothing.
- **Integrations** record details (https address, owner, method). Nothing is connected. Credentials are never asked for.
- **Approvals** are the adopter's own records. No one is notified.
- **Example conversations and sample scheme rows** are invented and marked as samples.

## Real backend work this depends on

- Calling an adopter's API or webhook from an agent (the product cannot yet be given user-defined tools)
- Production SIP and DTMF/IVR interoperability
- Human handoff to a staffed queue with the conversation attached
- Workflow orchestration and case routing
- Automated agent evaluation (the workspace test is not this)
- Retention and deletion controls; fine-grained roles and audit logs
- Outbound compliance controls (consent records, calling windows, do-not-call)
- Usage metering, call quality and cost monitoring
- Versioning and rollback
- Persisting a workspace server-side so a team can share it (today it is per browser)
- Knowledge ingestion beyond PDF, and structured scheme catalogues

## Unresolved product decisions

1. **Prices.** The ICP gives the commercial structure but no amounts. None are shown.
2. **Timelines.** The ICP ranges (days, weeks, weeks to months) are shown as typical, not committed.
3. **Contact route.** There is no support address or phone in the source material, so Help points to voicera.world and says so.
4. **Segment-to-application mapping.** The ICP maps applications to ULBs, NHAI, utilities, welfare, agriculture and surveys, but not Census or the three complex-administrative segments. Those mappings are marked "Our suggestion".
5. **Custom OpenAI-compatible LLM endpoint.** The ICP says it is supported. The repository check did not confirm it. It is flagged to confirm.
6. **Which languages are voice-ready** per deployment is not in the ICP. 13 Indian languages are offered, with a warning.
7. **Naming.** The ICP says "Platinum". Earlier internal documents used "Fully Loaded". This experience avoids the label.
8. **Should a workspace be shared** across a department team, and if so who owns it?
9. **Whether packages can mix** (for example Connect for form filling and Deploy for surveys in one account).

## Source material handling

The ICP is not modified. `DESIGN.md` in Downloads belongs to a different product and was not used.

---

# Package advisor and Scheme Discovery proof of concept (`/adopt/advisor`)

An adaptive advisor that checks a department's requirements against the **VoicEra Fully Loaded (Platinum)** package as documented, plus a guided
proof-of-concept builder for **Scheme Discovery**. It extends the experience above. It does not replace any of it.

## Run and test

```bash
cd frontend
npm run dev                 # open http://localhost:3000/adopt/advisor
npm run test:advisor        # 62 tests: rules, 10 required scenarios, cost, interpretation, PoC builder, zip writer
npx tsc --noEmit -p .
npx eslint src/app/adopt src/components/adopt src/lib/adopt
npx next build --webpack
```

`test:advisor` compiles `src/lib/adopt/advisor` with `tsc` and runs it with Node's built-in test runner. There is no new dependency.

## Routes

| Route | What it is |
|---|---|
| `/adopt/advisor` | Start: describe it, pick a use case, or explore by sector. A card leads to the PoC builder |
| `/adopt/advisor/questions` | The adaptive wizard, with a live check and your answers on the side |
| `/adopt/advisor/result` | The recommendation bundle: mapping, included, checklist, limits, plan, measures, cost, models, compare, reasoning, actions |
| `/adopt/advisor/faq` | FAQ and governance: only what the package document supports |
| `/adopt/advisor/poc` | Scheme Discovery walkthrough: schemes, questions, voice, knowledge files, try it, launch checklist |

## Where the rules come from

`src/lib/adopt/advisor/source.ts` holds the package as structured configuration. Every limit and price carries a source id that points at a
section of the supplied package document (`PKG-SCALE`, `PKG-KB`, `PKG-OOS` and so on). The UI shows these as chips. A statement with no
package source is shown as an **Assumption**. Nothing is hard-coded in components.

Documented limits used as rules: 500 concurrent calls; 10 knowledge files of 5 MB, text only; 10 campaign setups and monitoring activities a
month; conversations beyond 3 minutes not recommended; custom integration and WhatsApp calling out of scope; multi-modality and partial-stack
use not recommended; 11 documented languages; setup SLA of 2 working days after all requirements are provided.

Prices: Rs. 50,000 one-time setup, Rs. 500 per phone number, Rs. 0.50 a minute for open-source models (end to end including telephony). Proprietary
pricing is **not supplied**, so usage cost stays unresolved for it. No tax or recurring fee is added.

## How it decides

1. `questions.ts`: a registry of ~50 questions. Each has an id, plain label, why-we-ask text, kind, required flag, "Not sure yet" behaviour, the use
   cases it applies to, an earlier-answer trigger, what it affects (fit, feasibility, cost, dependency) and whether the package document speaks to it.
2. `answers.ts`: shows a question only when it applies. A scheme-discovery service that citizens call sees none of the outbound questions. Answers that stop
   applying are removed so they cannot skew the result. Required path for scheme discovery is at most 14 questions across about 7 steps.
3. `evaluate.ts`: fourteen dimensions (use-case fit, direction, duration, languages, knowledge base, telephony, integration, usage, campaign operations,
   hosting, data security, commercial completeness, readiness, dependencies). Each records the answer, the package requirement, a result, the consequence,
   the next action, the source and the named rules that fired (`R-USE-1`, `R-INT-1` and so on, all listed with their rationale in `RULES`).
4. Outcome: any blocked dimension gives **Outside documented Platinum scope**. Otherwise any review item, or a pending governance flag, gives **Needs technical or
   governance review**. Otherwise any condition or unconfirmed item gives **Suitable with conditions**. Only when none remain is it **Suitable based on supplied
   requirements**. An unknown answer is never treated as a fit.
5. `cost.ts`: integer paise arithmetic. One-time and usage costs are shown separately. When usage cannot be calculated the total is labelled as excluding it.

The interpretation of a free-text description (`interpret.ts`) is **rule-based, with no AI service**. It proposes, the person corrects it, and only then does it become answers.
Core eligibility, scope, limit and cost checks never depend on it.

## Scheme Discovery proof of concept

`poc.ts` turns a department's own scheme details into the two things the package asks the department to bring: a conversation script flow and a knowledge base.
Knowledge files are grouped so the count never passes 10 and no file passes 5 MB; any breach is reported. The PoC feeds the existing conversation simulation, can open
the existing workspace, and pre-fills the advisor, marking the generated script as **draft** and the files as **not yet approved** rather than claiming they are ready.
The worked example uses made-up schemes, each marked "(sample)".

## Changes to existing files (all small, all additive)

- `src/components/adopt/AdoptShell.tsx`: one nav link, "Advisor"
- `src/app/adopt/page.tsx`: one section pointing to the advisor and the PoC
- `src/components/adopt/Result.tsx` and `src/app/adopt/packages/page.tsx`: a short pointer each
- `src/lib/adopt/simulate.ts`: one-line fix so a scheme's documents list no longer ends with a doubled full stop
- `package.json`: the `test:advisor` script; new `tsconfig.advisor-test.json`

The advisor keeps its own state under `voicera.adopt.advisor.v1` in localStorage. The existing state, workspace pages and styles were not changed.

## Demo only

- Free-text reading is keyword rules, not AI.
- "Request an implementation discussion" prepares text on your device. It is **not sent** to Bhashini, VoicEra or anyone.
- The conversation simulation is scripted, as before. No speech, model or telephony.
- Exports (Markdown, CSV, zip) are generated in the browser. Nothing is uploaded.

## Unverified or open in the package document

Where call data is stored; whether it trains models; how long it is kept; whether a caller-number file can be read through an API; the actual voice and LLM options
(the document lists samples); the actual pre-integrated telephony partners (samples); proprietary-model pricing; model quality (Voice Arena report not supplied). The advisor
answers none of these. It states each as needing confirmation from the responsible VoicEra/Bhashini team.

## Choices made, and one correction to the brief

- The brief lists "a custom telephony provider" among integration needs. The package document documents it ("Option of using your Telephony Provider & Numbers", 2 to 4 weeks, case by case), so it is a
  condition, not an out-of-scope item. WhatsApp calling and custom integration with department systems are out of scope.
- The package document says partial-stack use should "refer to other packages". Those are not defined in the material supplied, so none is named or suggested.
- Retry rules, auditability and live transfer to a person are not in the package document, so they are flagged as unverified rather than assumed.
- Questions about response-dataset size and campaign duration were left out on purpose: no documented limit depends on them, so they could not change the result.
- Hosting and procurement are treated as a fit unless the department says they conflict, because the package states Bhashini hosting and billing.

---

# VoicERA Studio (`/studio`)

A different way in, for people who do not want to fill in forms. You describe the service in your own words and the Studio works out the rest.

- **One question at a time, chosen by what could decide the outcome** (`studio.ts`, `ASK_ORDER`). Things that can rule an idea out come first, and questions that do not apply are never asked. Answers already given in your first sentence are not asked again.
- **A live blueprint.** The call is drawn as numbered steps and redraws as you answer. Each step lights up for how well it fits the package, from the same rules as the advisor. A connection to a department system appears as a dashed red node.
- **It reacts.** After an answer it says so when something is outside the package, in the rule engine's own words, and stays quiet otherwise.
- **What would make it fit.** When the idea is outside scope or needs review, it lists changes (for example, explain eligibility from written rules instead of a live lookup) and re-runs the rules for each. "Make all of these changes" combines them. There is an undo. A change is only offered if it really improves the result.
- **Add or correct in your own words** at any time, and **change any earlier answer**. The blueprint follows.
- **Hear it.** A text simulation of the conversation, from your answers, for scheme discovery and for surveys.
- **Hand-over and cost.** The same checklist, estimator and exports as the advisor.

It shares answers with the advisor, so `/adopt/advisor/result` shows the same recommendation. Its conversation log is kept under `voicera.studio.v1`. The logic is in `src/lib/adopt/advisor/studio.ts` and is covered by `npm run test:advisor`. The reading of your first sentence is rule-based, with no AI service.

---

# VoicERA Composer (`/compose`)

The third way in, and the one with no questions at all. You **build** the service from blocks and the package rules **judge what you built**, live.

- **Blocks, not answers.** A palette of blocks (how the call starts, what is said, when it goes off the path, and things you might want to add). Click a block or drag it onto the call. The call is shown as a chain in the order a conversation runs.
- **Risky blocks are the point.** Adding "Check a citizen's record", "Allow calls longer than 3 minutes", "WhatsApp" or "More than 500 calls at once" turns the verdict red or amber at once, names the block that caused it, and offers "Remove it". Remove it and the verdict recovers.
- **Nothing is assumed.** What the department has in hand (script, knowledge, phone list, permission, test people, data sensitivity) is a row of Yes / Not yet / Unsure chips, all starting at Unsure. Unsure stays an open condition. Languages and the knowledge-base size are settings on the build.
- **Start however you like.** A starter shape, an empty canvas, or one sentence that is laid out as blocks (rule-based, no AI).
- **Hear it** and **Script** tabs follow the build. Cost, the checklist and exports sit in the verdict column.
- **"Open the full recommendation"** hands the composition to the advisor, so `/adopt/advisor/result` shows the same verdict.

Logic is in `src/lib/adopt/advisor/compose.ts`: a composition is turned into the same answers the rule engine already uses, so the limits, scope rules and prices are the advisor's. It is covered by `npm run test:advisor`. State is kept in this browser under `voicera.compose.v1`.

## Home page simplified

`/adopt` is now one headline, three choices (build a package around a budget, check if a package fits, hear a sample call) and a quiet row of links to everything else. The header shows five links and a "More" menu for the rest. No page was removed: Sectors, Applications, Packages, Find your fit, Composer, Help and All screens are all still reachable. The previous home page and header are saved as `orig/adopt-page.v2.tsx` and `orig/AdoptShell.v2.tsx` in the session scratchpad.

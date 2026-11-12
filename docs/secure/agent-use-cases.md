# Agent use cases: scheme agents and city feedback surveys

Agents are created as one of six **scheme agents**, from scratch, or with Agent Builder. (City feedback surveys still work for existing agents and can be picked from the Use case dropdown, but are no longer on the first screen.)

## The six scheme agents

A scheme agent is about one or more government schemes, and its **intent** says what the call is set up for. The intents are VoicEra's own way of splitting scheme calls, not an official government list:

| Intent | Schemes | What the agent does | Calls usually end as |
|---|---|---|---|
| Awareness | Up to 3 | Says what the scheme gives, checks if they already get it, gives the website or helpline | Interested, Already enrolled |
| Discovery | Any number | Asks up to four questions, explains the one or two schemes that may fit, documents and how to apply | Interested, Already enrolled |
| Enrolment | 1 | Checks they aren't enrolled, walks through where to go and what to bring, asks when they'll apply | Will apply, Already enrolled |
| Utilisation | 1 | Explains how the benefit is received or used, notes any problem and gives the complaint route | Knows next steps, Problem reported |
| Support | 1 | Asks if they've had a problem, understands it without asking for ID numbers, gives the helpline and the grievance portal | Problem reported, No problem |
| Feedback | 1 | Two-minute survey: did the benefit reach them, ease (1–5), staff (1–5), asked for extra money, one suggestion | Survey completed / partly done / declined |

Any call can also end as Call back later, Not interested, Wrong person, No answer or Unclear.

### Switching path during a call

You can't know in advance where the person is: someone called for awareness may already be enrolled, or have a problem. Every scheme agent's prompt has a **Switch path** section with all six paths (the cue to listen for and what to do), and each scheme's facts include what every path needs: the screening questions, the "are you already enrolled?" question, how the benefit is received, and where to go with a problem. The agent switches at most twice per call and closes normally. A Feedback agent skips the survey and follows Awareness or Enrolment if the person isn't enrolled, and Support if they describe a problem.

Call analysis follows the switch: a problem is recorded as **Problem reported** on any scheme agent, "I'll apply" as **Will apply** on any of them, and the call gets `switched_to` (the other intent's path). Campaign results show **Calls that switched path** per intent, and call details say "Switched to the Support path".

### Knowledge packs

Each scheme has a **knowledge pack**: a PDF with quick facts, the six paths, one section per intent (Awareness, Discovery, Enrolment, Utilisation, Support, Feedback), what never to do, and the sources. Ayushman Bharat PM-JAY's pack also has seven answers checked against PIB releases (70+ Vay Vandana card, CGHS choice, who's in the list, hospitals, pre-existing conditions, refusals and grievances, the missed-call number). Packs are written only from the checked catalogue facts and those sourced answers.

* **Built in, nothing to upload.** Packs ship with VoicEra (`app/services/knowledge_packs.py`); they don't go through the upload pipeline, so they need no indexing, object storage or embedding key. "Write the agent for me" writes the picked schemes' packs into the agent's prompt as a **Knowledge base (built in)** section: the pack's answers that the scheme facts don't already give, with sources (about 670 tokens for Ayushman Bharat, under 200 for most schemes). The Use case row shows the packs as Built in, with View.
* **On the Knowledge Base page**, a "Scheme knowledge packs · Built in" section lists every pack (including your own schemes') and opens it as a PDF (`GET /use-cases/knowledge/{scheme_id}`, `knowledge:read`). Your uploaded documents work as before and still need the embedding key.
* **Ready files.** The 16 built-in packs are in `docs/secure/knowledge-packs/` (and `knowledge-packs.zip`). Rebuild them after changing scheme facts: `PYTHONPATH="$PWD:$PWD/apps/api" .venv/bin/python scripts/secure/build_knowledge_packs.py`. Agents written earlier keep the pack text they were written with; write them again to pick up new facts.

All scheme agents share the same rules: never say someone is definitely eligible, never invent amounts or dates, never ask for Aadhaar, bank, card, OTP or PIN numbers or any payment, and stop when asked. Support and Utilisation send problems to the scheme's helpline or website, then to the central grievance portal (CPGRAMS, pgportal.gov.in).

### What changes per scheme: its kind

How a scheme is "used" depends on how its benefit reaches people, so each scheme has a **kind**: health cover, money paid to the bank, insurance, loan, savings or pension account, housing, connection or supply, registration or ID card, or other. The kind sets three things:

* the question that tells new from existing people ("Are you already covered under PMSBY?", "Do you already have the Ayushman card?")
* what the Utilisation agent explains (where to use the card, how to check a payment, how to make a claim…)
* the first Feedback question ("Did the last payment reach your bank account?", "Do you know how to make a claim if you need to?")

The kind text only describes the conversation. Every fact the agent states (benefit, eligibility, documents, how to apply, website, helpline) still comes from the scheme's own checked fields. Built-in kinds are in `SCHEME_KINDS`; for your own schemes you pick the kind in **Add your own scheme**.

### Where the call map comes from

A worked example for Ayushman Bharat (call map, sample calls, one scheme vs three, sample knowledge base) was published as a separate page during design. The rule it recommends is built in here: one scheme per agent for outbound campaigns (Enrolment, Utilisation, Support, Feedback), and a small bundle only for Awareness (up to 3) and Discovery.

## Two ways in: first agent and every agent after

**First-time users** (an organisation with no agents yet):

* **Home** (Agents) shows "What does a scheme agent do?": the six scheme agents, the four steps of a first agent, and one button, **Build your scheme discovery agent**. People who can't create agents see who builds the first one instead.
* That button opens a short flow, not the wizard (`QuickAgentFlow`):
  1. **Schemes:** pick a department (Health, Pension, Farmers, Housing, Women, Insurance, Livelihood, Workers, plus "State or city" for your own schemes), then its schemes; search works across all of them.
  2. **Your agent:** written for them as a Discovery agent (it switches to the other five paths when needed), with name and greeting editable, the full script viewable, and the schemes' knowledge packs shown as built in.
  3. **Language:** the only engine choice. Speech recognition, AI model, voice and call settings take the same best defaults the full wizard picks (`useWizardDefaults`); a short "Chosen for you" line names them. If the organisation has no provider connected for that language, it says so and links to Integrations instead of failing.
  4. **Ready:** the agent is created as a browser agent and can be tested on the spot; then Go to my agents, or Fine-tune settings.
* "Use the full setup instead" (`/agent-creation?full=1`) opens the full wizard at any point.

**From the second agent on**, Agents → New agent is the full wizard as before. The only change: picking schemes in the Use case row uses the same department → schemes view.

## In the wizard

1. **Agents → New agent** opens with the six scheme agent cards, then Start from scratch and Agent Builder.
2. The Agent step's **Use case** row is pre-set to that choice. It shows what the agent will do, the paths it can switch to, and how its calls usually end. Pick the scheme (one-scheme intents use radio buttons; Awareness stops at three). Feedback shows the five questions the agent will ask.
3. **Write the agent for me** fills in the name, greeting and prompt, with the schemes' knowledge packs built into the prompt; everything stays editable. The choice is saved on the agent as `config.use_case = {type: "scheme", intent, scheme_ids}`.

Agents saved before intents existed have `type: "scheme_discovery"`. They are read as `scheme` + `discovery` everywhere (API model, call analysis, dashboard), so they keep working unchanged.

## Results

* **Call outcome**: each intent records its own outcomes (table above). With the organisation's OpenAI key the model picks from that intent's outcomes; without it, built-in rules read the caller's words (English and Hinglish).
* **Problems reported** (Support, Utilisation): the problem types the caller mentioned, from a fixed list in `ISSUE_THEMES`: benefit or payment not received, asked for money, name or details wrong, refused at office or hospital, delay, no response from helpline or office. The campaign's Results show the share of answered calls with a problem and a count per type. Members see only the outcome, not the problem types.
* **Feedback**: works like a city survey. Results show each question's average rating or % yes and the most common problem types in the suggestion.
* The headline number follows the intent: Interested (Awareness, Discovery), Will apply (Enrolment), Problems reported (Support, Utilisation), Survey completed (Feedback, city surveys).
* Mock-provider calls get labelled made-up conversations for each intent (with the agent's scheme name), so every intent can be tried without a carrier.

## City feedback surveys

Pick one of 8 surveys (garbage collection, drinking water, roads and streetlights, public toilets, city buses, complaint follow-up, parks, overall city services). The agent asks for consent, then 4–5 short questions (ratings 1–5, yes/no, one open question), collects no personal details and keeps the call under three minutes. Survey answers are read by the OpenAI model when the key is set (any language), otherwise by matching each question by its words (English and Hinglish).

## Where the content comes from

Built in, not fetched live: `apps/api/app/services/use_cases.py`. There is no open feed of scheme rules, and an agent must not improvise amounts or eligibility.

* **16 central schemes** (PM-KISAN, Ayushman Bharat PM-JAY, PMAY-Gramin, PMAY-Urban 2.0, PM Ujjwala, e-Shram, Atal Pension, PMJJBY, PMSBY, PM SVANidhi, PM Mudra, Sukanya Samriddhi, PM Vishwakarma, NSAP old-age pension, PM Fasal Bima, PM Matru Vandana). Each field was checked against the official portal or a PIB release on the date in `FACTS_CHECKED` (2026-11-11); the URLs are in each scheme's `sources`. Helplines that couldn't be confirmed on an official page are left blank, and the agent then gives the website. Re-check the facts when schemes change (amounts and rules are revised often) and update `FACTS_CHECKED`.
* **Your own schemes**: the Super admin or an Admin can add state or city schemes (Add your own scheme), including how the benefit reaches people. They're stored per organisation in `CustomSchemes` and marked "Added by your team".
* **Intents, kinds and problem types**: `INTENTS`, `KINDS`, `SCHEME_KINDS` and `ISSUE_THEMES` in the same file.

API: `GET /use-cases` (catalogue: use cases, intents, kinds, schemes, surveys, feedback surveys), `POST /use-cases/preset` (`{use_case: "scheme", intent, scheme_ids}` or `{use_case: "city_survey", survey_id}`), `POST /use-cases/schemes` and `DELETE /use-cases/schemes/{id}` (custom schemes; `agents:write`). The preset response includes `knowledge` (the packs written into the prompt). Campaign results (`GET /campaign/{id}/analytics`) include `intent`, `issues_reported`, `issues` and `switched_paths`. Packs: `app/services/knowledge_packs.py`.

Tests: `apps/api/tests/test_use_cases.py`.

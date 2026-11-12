"""Agent use cases: scheme agents (one per intent) and city feedback surveys.

Each comes with a ready-made catalogue maintained here (not fetched live:
there is no open feed of scheme rules, and an agent must never improvise
eligibility or amounts):

* ``scheme`` - an agent about one or more government schemes, with an
  ``intent`` saying what the call is for (see ``INTENTS``): awareness,
  discovery, enrolment, utilisation, support or feedback. Scheme facts are
  written from the official portals and PIB releases listed in ``sources``,
  each with the date they were last checked. An organisation's Owner or Admin
  can add its own (state or city) schemes; those are stored per organisation.
  Agents saved before intents existed have type ``scheme_discovery``; that is
  read as ``scheme`` + ``discovery`` (:func:`normalise_use_case`).
* ``city_survey`` - citizen feedback surveys on city services, each a short
  script of rating, yes/no and open questions. Answers are extracted from
  call transcripts by ``call_analysis`` and summarised per campaign. Scheme
  ``feedback`` agents run the same kind of survey, built per scheme by
  :func:`scheme_feedback_survey`.

The intents are VoicEra's own way of splitting scheme calls, not an official
government list. What an intent does with a scheme depends on the scheme's
``kind`` (a cash transfer is "used" differently from insurance); the per-kind
text only describes the conversation and never adds facts about a scheme.

:func:`build_preset` turns a selection into the agent's name, purpose,
opening line and system prompt; the person creating the agent can edit them.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from app.database import get_database

CUSTOM_SCHEMES = "CustomSchemes"
FACTS_CHECKED = "2026-11-11"

USE_CASES: list[dict[str, str]] = [
    {
        "id": "scheme",
        "name": "Scheme agent",
        "description": "Calls citizens about government schemes, for one of six intents.",
    },
    {
        "id": "city_survey",
        "name": "City feedback survey",
        "description": "Collects citizens' ratings and feedback on a city service.",
    },
]

# What a scheme call is set up for. Every scheme agent can still switch to
# another intent's path during a call when the person turns out to be
# somewhere else (see ``_routing``). ``max_schemes`` None means any number.
# ``outcomes`` are the outcomes this intent's calls usually end with; a call
# that switched path can end with another intent's outcome.
_BASE_OUTCOMES = ["callback", "not_interested", "wrong_person", "no_answer", "unclear"]
INTENTS: list[dict[str, Any]] = [
    {
        "id": "awareness",
        "name": "Awareness",
        "description": "Tell people a scheme exists and what it gives, in under a minute.",
        "max_schemes": 3,
        "steps": ["Says what the scheme gives in one or two sentences", "Checks if they already get it", "Gives the website or helpline to those interested"],
        "outcomes": ["interested", "already_enrolled", *_BASE_OUTCOMES],
    },
    {
        "id": "discovery",
        "name": "Discovery",
        "description": "Ask a few questions to find which schemes may fit the family, and how to apply.",
        "max_schemes": None,
        "steps": ["Asks up to four short questions", "Explains the one or two schemes that may fit", "Gives documents and how to apply"],
        "outcomes": ["interested", "already_enrolled", *_BASE_OUTCOMES],
    },
    {
        "id": "enrolment",
        "name": "Enrolment",
        "description": "Help people who may be eligible apply or register, step by step.",
        "max_schemes": 1,
        "steps": ["Checks they aren't already enrolled", "Walks through where to go and what to bring", "Asks when they plan to apply"],
        "outcomes": ["will_apply", "already_enrolled", *_BASE_OUTCOMES],
    },
    {
        "id": "utilisation",
        "name": "Utilisation",
        "description": "Make sure people already in the scheme know how to actually get the benefit.",
        "max_schemes": 1,
        "steps": ["Checks they are enrolled", "Explains how the benefit is received or used", "Notes any problem and gives the complaint route"],
        "outcomes": ["informed", "issue_reported", *_BASE_OUTCOMES],
    },
    {
        "id": "support",
        "name": "Support",
        "description": "Check whether people in the scheme have had a problem, and send it to the right channel.",
        "max_schemes": 1,
        "steps": ["Asks if they have had any problem", "Understands what went wrong, without asking for ID numbers", "Gives the helpline and grievance portal"],
        "outcomes": ["issue_reported", "no_issue", *_BASE_OUTCOMES],
    },
    {
        "id": "feedback",
        "name": "Feedback",
        "description": "A two-minute survey on whether the benefit reached people and how the process felt.",
        "max_schemes": 1,
        "steps": ["Asks for consent", "Asks five short questions in order", "Results appear in the campaign's survey section"],
        "outcomes": ["survey_completed", "survey_partial", "survey_declined", "callback", "wrong_person", "no_answer"],
    },
]
INTENT_IDS = tuple(i["id"] for i in INTENTS)

# One line per intent for the in-call routing section: the cue, then what to do.
_PATHS: dict[str, tuple[str, str]] = {
    "awareness": ("they haven't heard of the scheme", "say in one or two sentences what it gives"),
    "discovery": ("they've heard of it but don't know if it fits them", "ask the scheme's questions one at a time, at most four"),
    "enrolment": ("they want to apply", "explain how to apply and read the documents to bring slowly; there is no fee to apply"),
    "utilisation": ("they're already enrolled", "explain how to get the benefit, as written under the scheme"),
    "support": ("they have a problem with the scheme", "listen, say you're sorry, and give the scheme's complaint route, then the grievance portal"),
    "feedback": ("they've used the scheme and want to say how it went", "listen, ask how easy it was from 1 to 5, and thank them"),
}

# How a scheme's benefit reaches people. Drives the "are you already in it?"
# question, what "using" the scheme means, and the first feedback question.
# This text describes the conversation only: every fact the agent states
# still comes from the scheme's own fields.
KINDS: dict[str, dict[str, str]] = {
    "health": {
        "label": "Health cover",
        "enrolled_question": "Do you or your family already have the {name} card?",
        "use": "Explain how to use the cover when someone needs treatment: go to a listed hospital, show the card at the scheme's help desk, and check with the helpline which hospitals are listed.",
        "received_question": "When your family needed treatment, did you get it without paying at the hospital?",
    },
    "cash": {
        "label": "Money paid to the bank",
        "enrolled_question": "Are you already registered for {name}?",
        "use": "Explain that the benefit is paid into the bank account, how much and how often (only as stated in the facts), and that they can check the payment status on the official website or helpline.",
        "received_question": "Did the last payment reach your bank account?",
    },
    "insurance": {
        "label": "Insurance",
        "enrolled_question": "Are you already covered under {name}?",
        "use": "Explain that using the cover means making a claim when something happens: contact the bank, office or insurer where they enrolled, or the official helpline, as soon as possible because claims have time limits. If the cover is renewed every year or season, remind them to renew it in time.",
        "received_question": "Do you know how to make a claim if you need to?",
    },
    "loan": {
        "label": "Loan",
        "enrolled_question": "Have you already taken a loan under {name}?",
        "use": "Explain that repaying on time keeps their record good, and that they can ask their lender about any next loan or extra benefit stated in the facts.",
        "received_question": "Did you get the loan amount you applied for?",
    },
    "savings": {
        "label": "Savings or pension account",
        "enrolled_question": "Do you already have a {name} account?",
        "use": "Explain that the benefit depends on paying in regularly, and that they can check and pay into the account at the bank or post office where it was opened.",
        "received_question": "Are you able to pay into the account regularly?",
    },
    "housing": {
        "label": "Housing",
        "enrolled_question": "Have you already applied for or been approved under {name}?",
        "use": "Explain that they can check their application or payment status with the office named in the facts or on the official website.",
        "received_question": "Has your application or house moved forward as you expected?",
    },
    "connection": {
        "label": "Connection or supply",
        "enrolled_question": "Do you already have a {name} connection?",
        "use": "Explain the refill or supply benefit stated in the facts, and that they book refills with their distributor.",
        "received_question": "Are you able to get refills when you need them?",
    },
    "registration": {
        "label": "Registration or ID card",
        "enrolled_question": "Have you already registered for {name}?",
        "use": "Explain what registering gives them (only as stated in the facts), and that they can update their details on the official website or at a Common Service Centre.",
        "received_question": "Have you been able to use the benefits of your registration?",
    },
    "other": {
        "label": "Other",
        "enrolled_question": "Are you already getting {name}?",
        "use": "Explain how the benefit is received, using only the facts given.",
        "received_question": "Have you received the benefit?",
    },
}
SCHEME_KINDS = {
    "pm-kisan": "cash", "pm-jay": "health", "pmay-g": "housing", "pmay-u": "housing", "pmuy": "connection",
    "e-shram": "registration", "apy": "savings", "pmjjby": "insurance", "pmsby": "insurance", "pm-svanidhi": "loan",
    "mudra": "loan", "ssy": "savings", "pm-vishwakarma": "registration", "nsap-oap": "cash", "pmfby": "insurance",
    "pmmvy": "cash",
}

# Problems people report about a scheme, matched in support and utilisation
# calls and in feedback surveys' open answers.
ISSUE_THEMES: dict[str, list[str]] = {
    "Benefit or payment not received": ["not received", "haven't received", "have not received", "didn't get", "did not get",
                                        "not credited", "hasn't come", "has not come", "not come", "no money", "stopped"],
    "Asked for money": ["bribe", "asked for money", "asked me to pay", "asked us to pay", "extra money", "commission", "pay something"],
    "Name or details wrong": ["name is not", "not in the list", "wrong name", "spelling", "mismatch", "details are wrong", "rejected"],
    "Refused at office or hospital": ["refused", "denied", "sent back", "turned away", "didn't accept", "did not accept"],
    "Delay": ["delay", "too long", "months", "weeks", "still waiting", "pending"],
    "No response from helpline or office": ["no one", "nobody", "no response", "not answering", "didn't answer", "no reply"],
}

# Central government grievance portal (CPGRAMS) for problems the scheme's own channels don't fix.
GRIEVANCE_PORTAL = "pgportal.gov.in"

# Scheme facts are read aloud to citizens: keep each field to one or two plain
# sentences, and only state what the official sources say.
SCHEMES: list[dict[str, Any]] = [
    {
        "id": "pm-kisan",
        "name": "PM-KISAN",
        "category": "Farmers",
        "summary": "₹6,000 a year for landholding farmer families.",
        "benefit": "₹6,000 a year, paid in three instalments of ₹2,000 directly into the farmer's bank account.",
        "eligibility": "Landholding farmer families. Not for income-tax payers, holders of constitutional posts, serving or retired government officers (except Group D/MTS), pensioners getting ₹10,000 or more a month, or registered professionals such as doctors, engineers and lawyers.",
        "documents": ["Aadhaar", "Land records", "Bank account linked to Aadhaar"],
        "how_to_apply": "Register on the PM-KISAN portal or at a Common Service Centre, and complete e-KYC.",
        "website": "pmkisan.gov.in",
        "helpline": "155261",
        "questions": ["Does your family own farm land in your name?", "Does anyone in the family pay income tax or hold a government job?"],
        "sources": ["https://pmkisan.gov.in", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2228842"],
    },
    {
        "id": "pm-jay",
        "name": "Ayushman Bharat PM-JAY",
        "category": "Health",
        "summary": "Free hospital treatment up to ₹5 lakh a year per family.",
        "benefit": "Cashless treatment up to ₹5 lakh per family per year for hospital admission at listed government and private hospitals; a person aged 70 or above gets up to ₹5 lakh more just for themselves.",
        "eligibility": "Poor and vulnerable families in the official beneficiary lists (SECC 2011 and state additions), ASHA and Anganwadi workers and their families, and all senior citizens aged 70 or above regardless of income.",
        "documents": ["Aadhaar", "Ration card or PM-JAY letter, if available"],
        "how_to_apply": "Check your name and get the Ayushman card at beneficiary.nha.gov.in, the Ayushman app, a listed hospital or a Common Service Centre.",
        "website": "beneficiary.nha.gov.in",
        "helpline": "14555",
        "questions": ["Is anyone in your family aged 70 or above?", "Do you have a ration card or a PM-JAY letter?"],
        "sources": ["https://www.pib.gov.in/PressReleasePage.aspx?PRID=2082288", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2116209", "https://beneficiary.nha.gov.in"],
    },
    {
        "id": "pmay-g",
        "name": "PM Awas Yojana – Gramin",
        "category": "Housing",
        "summary": "Help to build a pucca house in villages.",
        "benefit": "₹1.20 lakh in plains or ₹1.30 lakh in hilly and difficult areas to build a pucca house, plus wages for 90 to 95 days under MGNREGA and ₹12,000 for a toilet.",
        "eligibility": "Rural families without a pucca house, picked from the SECC 2011 waiting list and the updated Awaas Plus list, and checked by the gram sabha.",
        "documents": ["Aadhaar", "Bank account", "MGNREGA job card"],
        "how_to_apply": "Contact your gram panchayat or block office to check the beneficiary list.",
        "website": "pmayg.dord.gov.in",
        "helpline": "",
        "questions": ["Do you live in a village?", "Does your family live in a kutcha or damaged house?"],
        "sources": ["https://www.pib.gov.in/PressReleasePage.aspx?PRID=2043921", "https://pmayg.dord.gov.in"],
    },
    {
        "id": "pmay-u",
        "name": "PM Awas Yojana – Urban 2.0",
        "category": "Housing",
        "summary": "Help to build, buy or rent a house in cities.",
        "benefit": "Up to ₹2.5 lakh per house for EWS families to build or buy (central and state share together), or a 4% interest subsidy on the first ₹8 lakh of a home loan, up to ₹1.80 lakh, for a house worth up to ₹35 lakh.",
        "eligibility": "Urban families with yearly income up to ₹9 lakh (EWS up to ₹3 lakh, LIG ₹3 to 6 lakh, MIG ₹6 to 9 lakh) who don't own a pucca house anywhere in India.",
        "documents": ["Aadhaar of all family members", "Income certificate", "Bank account"],
        "how_to_apply": "Apply on the PMAY-Urban portal or through your urban local body.",
        "website": "pmay-urban.gov.in",
        "helpline": "",
        "questions": ["Do you live in a town or city?", "Does your family own a pucca house anywhere in India?"],
        "sources": ["https://www.pib.gov.in/PressReleasePage.aspx?PRID=2043924", "https://pmay-urban.gov.in"],
    },
    {
        "id": "pmuy",
        "name": "PM Ujjwala Yojana",
        "category": "Women",
        "summary": "Free LPG connection for women from poor households.",
        "benefit": "A deposit-free LPG connection with the first refill and a stove free, and a ₹300 subsidy per cylinder credited to the bank account on a set number of refills each year.",
        "eligibility": "An adult woman (18 or above) from a poor household that has no LPG connection.",
        "documents": ["Aadhaar", "Ration card", "Bank account"],
        "how_to_apply": "Apply at your nearest LPG distributor or on the Ujjwala portal.",
        "website": "pmuy.gov.in",
        "helpline": "14438, or 1906 for LPG emergencies",
        "questions": ["Does your household already have an LPG connection?"],
        "sources": ["https://www.pmuy.gov.in/ujjwala2.html", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2154117"],
    },
    {
        "id": "e-shram",
        "name": "e-Shram",
        "category": "Workers",
        "summary": "Free registration card for unorganised workers.",
        "benefit": "A free e-Shram card with a 12-digit number (UAN), and the option to join PM Suraksha Bima Yojana: ₹2 lakh for accidental death or permanent disability and ₹1 lakh for partial disability, for ₹20 a year.",
        "eligibility": "Unorganised workers aged 16 or above who are not EPFO or ESIC members and don't pay income tax.",
        "documents": ["Aadhaar", "Mobile number linked to Aadhaar", "Bank account"],
        "how_to_apply": "Register free on the e-Shram portal or at a Common Service Centre.",
        "website": "eshram.gov.in",
        "helpline": "14434 or 1800-889-6811",
        "questions": ["Do you work as a daily-wage, gig, domestic or other unorganised worker?"],
        "sources": ["https://eshram.gov.in/faqs", "https://eshram.gov.in/social-security-welfare-schemes"],
    },
    {
        "id": "apy",
        "name": "Atal Pension Yojana",
        "category": "Pension",
        "summary": "Guaranteed pension from age 60.",
        "benefit": "A guaranteed pension of ₹1,000 to ₹5,000 a month from age 60, depending on how much you contribute; after the subscriber, the spouse gets the same pension.",
        "eligibility": "People aged 18 to 40 with a bank or post office savings account who don't pay income tax.",
        "documents": ["Aadhaar", "Savings bank account"],
        "how_to_apply": "Join through your bank or post office.",
        "website": "pfrda.org.in",
        "helpline": "1800-110-069",
        "questions": ["How old are you?", "Do you have a bank or post office savings account?"],
        "sources": ["https://pfrda.org.in/web/pfrda/schemes/atal-pension-yojana-apy", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2244485"],
    },
    {
        "id": "pmjjby",
        "name": "PM Jeevan Jyoti Bima Yojana",
        "category": "Insurance",
        "summary": "₹2 lakh life cover for ₹436 a year.",
        "benefit": "Life cover of ₹2 lakh for death from any cause, for a premium of ₹436 a year taken from your bank account; if you join before 50 you stay covered up to 55 while you keep paying.",
        "eligibility": "People aged 18 to 50 with a bank or post office savings account.",
        "documents": ["Aadhaar", "Savings bank account"],
        "how_to_apply": "Join through your bank or post office.",
        "website": "financialservices.gov.in",
        "helpline": "",
        "questions": ["How old are you?", "Do you have a bank or post office savings account?"],
        "sources": ["https://financialservices.gov.in/pradhan-mantri-jeevan-jyoti-bima-yojana-pmjjby"],
    },
    {
        "id": "pmsby",
        "name": "PM Suraksha Bima Yojana",
        "category": "Insurance",
        "summary": "₹2 lakh accident cover for ₹20 a year.",
        "benefit": "Accident cover of ₹2 lakh for death or total disability and ₹1 lakh for partial disability, for ₹20 a year.",
        "eligibility": "People aged 18 to 70 with a bank or post office savings account.",
        "documents": ["Aadhaar", "Savings bank account"],
        "how_to_apply": "Join through your bank or post office.",
        "website": "financialservices.gov.in",
        "helpline": "",
        "questions": ["How old are you?", "Do you have a bank or post office savings account?"],
        "sources": ["https://financialservices.gov.in/pradhan-mantri-suraksha-bima-yojana-pmsby"],
    },
    {
        "id": "pm-svanidhi",
        "name": "PM SVANidhi",
        "category": "Livelihood",
        "summary": "Small working-capital loans for street vendors.",
        "benefit": "Loans without collateral of ₹15,000, then ₹25,000, then ₹50,000 as each is repaid, a 7% interest subsidy for paying on time, cashback of up to ₹1,600 for digital payments, and a UPI-linked RuPay credit card after the second loan.",
        "eligibility": "Street vendors in towns, census towns and peri-urban areas with a vending certificate or a letter of recommendation from the urban local body.",
        "documents": ["Aadhaar", "Vending certificate or recommendation letter", "Bank account"],
        "how_to_apply": "Apply on the PM SVANidhi portal or app, or through your urban local body.",
        "website": "pmsvanidhi.mohua.gov.in",
        "helpline": "",
        "questions": ["Do you sell goods on the street or from a cart in a town or city?"],
        "sources": ["https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/may/doc2026530879701.pdf", "https://pmsvanidhi.mohua.gov.in"],
    },
    {
        "id": "mudra",
        "name": "PM Mudra Yojana",
        "category": "Livelihood",
        "summary": "Collateral-free loans for small businesses.",
        "benefit": "Loans without collateral for small non-farm businesses: Shishu up to ₹50,000, Kishore up to ₹5 lakh, Tarun up to ₹10 lakh, and Tarun Plus up to ₹20 lakh for those who repaid a Tarun loan.",
        "eligibility": "Anyone starting or running a small non-farm business such as a shop, workshop or service, including activities allied to farming like poultry, dairy and beekeeping.",
        "documents": ["Aadhaar", "Business plan or details", "Bank account"],
        "how_to_apply": "Apply at a bank, NBFC or microfinance institution, or on the Udyamimitra portal.",
        "website": "mudra.org.in",
        "helpline": "",
        "questions": ["Do you run or want to start a small business?"],
        "sources": ["https://www.pib.gov.in/PressReleasePage.aspx?PRID=2249915", "https://www.mudra.org.in"],
    },
    {
        "id": "ssy",
        "name": "Sukanya Samriddhi Yojana",
        "category": "Women",
        "summary": "Savings account for a girl child with high interest.",
        "benefit": "A savings account for a girl child with a government-set interest rate and tax benefit; deposits of ₹250 to ₹1.5 lakh a year for 15 years, and the account matures 21 years after it was opened.",
        "eligibility": "A girl child below 10 years, at most two girls per family (twins and triplets excepted); the account is opened by a parent or guardian.",
        "documents": ["Girl's birth certificate", "Parent's Aadhaar and address proof"],
        "how_to_apply": "Open the account at a post office or authorised bank.",
        "website": "indiapost.gov.in",
        "helpline": "",
        "questions": ["Do you have a daughter below 10 years of age?"],
        "sources": ["https://www.indiapost.gov.in/banking-services/savings"],
    },
    {
        "id": "pm-vishwakarma",
        "name": "PM Vishwakarma",
        "category": "Livelihood",
        "summary": "Training, toolkit and cheap loans for artisans.",
        "benefit": "A recognition certificate and ID card, skill training with ₹500 a day stipend, a ₹15,000 toolkit voucher, and loans without collateral of ₹1 lakh and then ₹2 lakh at 5% interest.",
        "eligibility": "Self-employed artisans and craftspeople aged 18 or above in one of 18 trades such as carpenter, blacksmith, potter, tailor or cobbler; one person per family; not for government employees or anyone with an unpaid PMEGP, PM SVANidhi or Mudra loan.",
        "documents": ["Aadhaar", "Mobile number", "Bank account"],
        "how_to_apply": "Register at a Common Service Centre.",
        "website": "pmvishwakarma.gov.in",
        "helpline": "18002677777 or 17923",
        "questions": ["What trade or craft do you work in?", "Do you work for yourself?"],
        "sources": ["https://pmvishwakarma.gov.in/Home/FAQ", "https://pmvishwakarma.gov.in/Home/ContactUs"],
    },
    {
        "id": "nsap-oap",
        "name": "Old-age pension (NSAP)",
        "category": "Pension",
        "summary": "Monthly pension for elderly people from poor households.",
        "benefit": "A monthly pension from the central government (₹200 from age 60, ₹500 from age 80), with most states adding more.",
        "eligibility": "People aged 60 or above from households below the poverty line.",
        "documents": ["Age proof", "Aadhaar", "BPL card", "Bank account"],
        "how_to_apply": "Apply through the state social welfare department, gram panchayat or municipality.",
        "website": "nsap.nic.in",
        "helpline": "",
        "questions": ["Is anyone in your family aged 60 or above?", "Does your household have a BPL card?"],
        "sources": ["https://www.pib.gov.in/PressReleasePage.aspx?PRID=2244485", "https://nsap.nic.in"],
    },
    {
        "id": "pmfby",
        "name": "PM Fasal Bima Yojana",
        "category": "Farmers",
        "summary": "Low-cost crop insurance.",
        "benefit": "Crop insurance against natural disasters, pests and disease; farmers pay 2% for kharif, 1.5% for rabi and 5% for commercial or horticulture crops.",
        "eligibility": "Farmers growing notified crops in notified areas, including tenant farmers and sharecroppers. Farmers without a crop loan can enrol voluntarily; for farmers with a crop loan, the bank deducts the premium.",
        "documents": ["Aadhaar", "Land records or tenancy agreement", "Bank account", "Sowing certificate"],
        "how_to_apply": "Enrol through your bank, a Common Service Centre, the insurance company or the PMFBY portal before the season's last date.",
        "website": "pmfby.gov.in",
        "helpline": "14447",
        "questions": ["Do you grow crops this season?", "Have you insured them already?"],
        "sources": ["https://pmfby.gov.in", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2304549"],
    },
    {
        "id": "pmmvy",
        "name": "PM Matru Vandana Yojana",
        "category": "Women",
        "summary": "Cash support for pregnant women and new mothers.",
        "benefit": "₹5,000 for the first child in two instalments, and ₹6,000 for a second child if it is a girl.",
        "eligibility": "Pregnant and breastfeeding women aged 18 to 55 from disadvantaged groups, for example SC or ST, a BPL or NFSA ration card, an e-Shram or MGNREGA card, PM-JAY, or family income under ₹8 lakh. Not for women in regular government or PSU jobs.",
        "documents": ["Aadhaar", "Mother and child protection card", "Bank account"],
        "how_to_apply": "Apply within 270 days of the birth through your anganwadi worker or ASHA, on the PMMVY portal or on UMANG.",
        "website": "pmmvy.wcd.gov.in",
        "helpline": "1515",
        "questions": ["Is anyone in your family pregnant or a new mother?"],
        "sources": ["https://wcd.gov.in/offerings/pradhan-mantri-matru-vandana-yojana", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2182173"],
    },
]

# kind: rating (1-5), yes_no or open. complaint_themes maps a short theme to
# words that signal it in the open answer, for the campaign summary.
SURVEYS: list[dict[str, Any]] = [
    {
        "id": "cleanliness",
        "name": "Garbage collection and cleanliness",
        "topic": "garbage collection and cleanliness in your area",
        "questions": [
            {"id": "frequency", "kind": "yes_no", "text": "Does the garbage vehicle come to your street every day?"},
            {"id": "segregation", "kind": "yes_no", "text": "Do the collectors take wet and dry waste separately?"},
            {"id": "street_clean", "kind": "rating", "text": "How clean are the streets in your area, from 1 to 5?"},
            {"id": "overall", "kind": "rating", "text": "Overall, how satisfied are you with garbage collection, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "What one thing should the city improve?"},
        ],
        "complaint_themes": {
            "Missed or irregular pickup": ["not come", "doesn't come", "irregular", "missed", "skip", "once a week", "late"],
            "Garbage piling up": ["pile", "heap", "dump", "overflow", "smell", "stink"],
            "Dirty streets or drains": ["drain", "dirty", "sweep", "gutter"],
        },
    },
    {
        "id": "water",
        "name": "Drinking water supply",
        "topic": "drinking water supply at your home",
        "questions": [
            {"id": "daily", "kind": "yes_no", "text": "Do you get piped water at home every day?"},
            {"id": "hours", "kind": "open", "text": "For about how many hours a day do you get water?"},
            {"id": "quality", "kind": "rating", "text": "How would you rate the water quality, from 1 to 5?"},
            {"id": "pressure", "kind": "rating", "text": "How would you rate the water pressure, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "What one thing should the city improve about water supply?"},
        ],
        "complaint_themes": {
            "Irregular supply": ["irregular", "no water", "not daily", "alternate", "once", "tanker"],
            "Poor quality": ["dirty", "muddy", "smell", "colour", "color", "yellow", "contaminat"],
            "Low pressure": ["pressure", "slow", "trickle", "motor"],
            "Leaks": ["leak", "burst", "pipe"],
        },
    },
    {
        "id": "roads",
        "name": "Roads and streetlights",
        "topic": "roads and streetlights in your area",
        "questions": [
            {"id": "road_condition", "kind": "rating", "text": "How would you rate the condition of roads near your home, from 1 to 5?"},
            {"id": "potholes", "kind": "yes_no", "text": "Are there potholes on your street that haven't been fixed?"},
            {"id": "streetlights", "kind": "rating", "text": "How well do the streetlights work at night, from 1 to 5?"},
            {"id": "safety", "kind": "rating", "text": "How safe do you feel walking at night, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "Which road or light needs attention first?"},
        ],
        "complaint_themes": {
            "Potholes and broken roads": ["pothole", "broken", "damaged", "crack", "dug"],
            "Streetlights not working": ["light", "dark", "bulb", "lamp"],
            "Waterlogging": ["water logging", "waterlog", "flood", "water standing"],
        },
    },
    {
        "id": "toilets",
        "name": "Public toilets",
        "topic": "public toilets in your area",
        "questions": [
            {"id": "used", "kind": "yes_no", "text": "Have you used a public toilet in your area in the last month?"},
            {"id": "clean", "kind": "rating", "text": "How clean was it, from 1 to 5?"},
            {"id": "water_light", "kind": "yes_no", "text": "Did it have water and working lights?"},
            {"id": "women_safety", "kind": "rating", "text": "How safe and comfortable is it for women, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "What should be improved?"},
        ],
        "complaint_themes": {
            "Dirty": ["dirty", "smell", "stink", "unclean"],
            "No water or lights": ["no water", "water", "light", "dark"],
            "Closed or too few": ["closed", "locked", "far", "no toilet", "few"],
        },
    },
    {
        "id": "buses",
        "name": "City buses",
        "topic": "city bus service",
        "questions": [
            {"id": "uses_bus", "kind": "yes_no", "text": "Do you travel by city bus at least once a week?"},
            {"id": "wait", "kind": "rating", "text": "How would you rate the waiting time for buses, from 1 to 5?"},
            {"id": "crowding", "kind": "rating", "text": "How comfortable are the buses, from 1 to 5?"},
            {"id": "staff", "kind": "rating", "text": "How would you rate the behaviour of the bus staff, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "Which route or stop needs improvement?"},
        ],
        "complaint_themes": {
            "Long waits": ["wait", "late", "delay", "frequency", "not come"],
            "Overcrowding": ["crowd", "full", "standing", "rush"],
            "Staff behaviour": ["rude", "conductor", "driver", "behaviour", "behavior"],
            "Bus stops": ["stop", "shelter", "shed"],
        },
    },
    {
        "id": "complaint_followup",
        "name": "Was your complaint fixed?",
        "topic": "the complaint you recently registered with the city",
        "questions": [
            {"id": "resolved", "kind": "yes_no", "text": "Has the problem you complained about been fixed?"},
            {"id": "time", "kind": "rating", "text": "How satisfied are you with how long it took, from 1 to 5?"},
            {"id": "updates", "kind": "yes_no", "text": "Did you get updates on your complaint?"},
            {"id": "overall", "kind": "rating", "text": "Overall, how satisfied are you with how your complaint was handled, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "Is there anything else you'd like to tell us?"},
        ],
        "complaint_themes": {
            "Not fixed": ["not fixed", "still", "pending", "not resolved", "nothing happened"],
            "Took too long": ["long", "late", "weeks", "months", "delay"],
            "No updates": ["no update", "no call", "no message", "nobody"],
        },
    },
    {
        "id": "parks",
        "name": "Parks and public spaces",
        "topic": "parks and public spaces near you",
        "questions": [
            {"id": "visits", "kind": "yes_no", "text": "Do you visit a park or open ground near your home?"},
            {"id": "upkeep", "kind": "rating", "text": "How well is it maintained, from 1 to 5?"},
            {"id": "facilities", "kind": "rating", "text": "How would you rate the facilities like benches, lights and play areas, from 1 to 5?"},
            {"id": "safety", "kind": "rating", "text": "How safe do you feel there, from 1 to 5?"},
            {"id": "suggestion", "kind": "open", "text": "What would you like added or fixed?"},
        ],
        "complaint_themes": {
            "Poor upkeep": ["dirty", "grass", "garbage", "maintain", "broken"],
            "Lighting and safety": ["light", "dark", "unsafe", "safety", "drunk"],
            "Missing facilities": ["bench", "toilet", "play", "swing", "gym", "walking track"],
        },
    },
    {
        "id": "overall",
        "name": "Overall city services",
        "topic": "city services overall",
        "questions": [
            {"id": "cleanliness", "kind": "rating", "text": "How would you rate cleanliness in your area, from 1 to 5?"},
            {"id": "water", "kind": "rating", "text": "How would you rate water supply, from 1 to 5?"},
            {"id": "roads", "kind": "rating", "text": "How would you rate roads and streetlights, from 1 to 5?"},
            {"id": "grievance", "kind": "rating", "text": "How easy is it to get a complaint resolved by the city, from 1 to 5?"},
            {"id": "priority", "kind": "open", "text": "What should the city fix first?"},
        ],
        "complaint_themes": {
            "Garbage and cleanliness": ["garbage", "clean", "dirty", "waste"],
            "Water": ["water", "tap", "supply"],
            "Roads and lights": ["road", "pothole", "light"],
            "Complaints ignored": ["complaint", "nobody", "no response", "ignored"],
        },
    },
]

_SCHEME_FIELDS = ("name", "category", "summary", "benefit", "eligibility", "how_to_apply", "website", "helpline")
_ID_CLEAN = re.compile(r"[^a-z0-9]+")


class UseCaseError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _builtin_scheme(scheme: dict[str, Any]) -> dict[str, Any]:
    return {**scheme, "kind": SCHEME_KINDS.get(scheme["id"], "other"), "custom": False, "last_checked": FACTS_CHECKED}


def list_custom_schemes(org_id: str) -> list[dict[str, Any]]:
    cursor = get_database()[CUSTOM_SCHEMES].find({"org_id": org_id}, {"_id": 0, "org_id": 0}).sort("created_at", -1)
    return [{**d, "kind": d.get("kind") if d.get("kind") in KINDS else "other", "custom": True} for d in cursor]


def get_intent(intent_id: str | None) -> dict[str, Any] | None:
    return next((i for i in INTENTS if i["id"] == intent_id), None)


def normalise_use_case(use_case: Any) -> dict[str, Any] | None:
    """A stored or submitted use case in its current shape (legacy ``scheme_discovery`` included)."""
    if not isinstance(use_case, dict):
        return None
    kind = use_case.get("type")
    if kind in ("scheme", "scheme_discovery"):
        intent = use_case.get("intent") if use_case.get("intent") in INTENT_IDS else "discovery"
        return {"type": "scheme", "intent": intent, "scheme_ids": list(use_case.get("scheme_ids") or []), "survey_id": None}
    if kind == "city_survey":
        return {"type": "city_survey", "intent": None, "scheme_ids": [], "survey_id": use_case.get("survey_id")}
    return None


def scheme_feedback_survey(scheme: dict[str, Any]) -> dict[str, Any]:
    """The survey a scheme ``feedback`` agent runs (same shape as a city survey)."""
    kind = KINDS.get(scheme.get("kind") or "other", KINDS["other"])
    return {
        "id": f"scheme-feedback:{scheme['id']}",
        "name": f"{scheme['name']} feedback",
        "topic": f"your experience with {scheme['name']}",
        "scheme_id": scheme["id"],
        "questions": [
            {"id": "received", "kind": "yes_no", "text": kind["received_question"]},
            {"id": "ease", "kind": "rating", "text": "How easy was it to apply and get the benefit, from 1 to 5?"},
            {"id": "staff", "kind": "rating", "text": "How helpful were the office, bank or helpline staff, from 1 to 5?"},
            {"id": "asked_money", "kind": "yes_no", "text": "Did anyone ask you for extra money to get this benefit?"},
            {"id": "suggestion", "kind": "open", "text": "What one thing would make this scheme work better for you?"},
        ],
        "complaint_themes": ISSUE_THEMES,
        "reply_key": "scheme_feedback",
    }


def catalogue(org_id: str) -> dict[str, Any]:
    from app.services.knowledge_packs import pack_filename

    schemes = [_builtin_scheme(s) for s in SCHEMES] + list_custom_schemes(org_id)
    schemes = [{**s, "pack_name": pack_filename(s)} for s in schemes]
    return {
        "use_cases": USE_CASES,
        "intents": INTENTS,
        "kinds": [{"id": k, "label": v["label"]} for k, v in KINDS.items()],
        "schemes": schemes,
        "surveys": SURVEYS,
        "feedback_surveys": [scheme_feedback_survey(s) for s in schemes],
        "facts_checked": FACTS_CHECKED,
    }


def add_custom_scheme(org_id: str, data: dict[str, Any], *, actor_email: str) -> dict[str, Any]:
    clean = {k: " ".join(str(data.get(k) or "").split())[:600] for k in _SCHEME_FIELDS}
    if not clean["name"] or not clean["benefit"] or not clean["eligibility"] or not clean["how_to_apply"]:
        raise UseCaseError("Give the scheme a name, who can get it, the benefit and how to apply.")
    kind = str(data.get("kind") or "other")
    if kind not in KINDS:
        raise UseCaseError("Pick how the scheme's benefit reaches people.")
    slug = _ID_CLEAN.sub("-", clean["name"].lower()).strip("-")[:40] or "scheme"
    doc = {
        **clean,
        "id": f"custom-{slug}-{secrets.token_hex(3)}",
        "org_id": org_id,
        "kind": kind,
        "category": clean["category"] or "State or city",
        "summary": clean["summary"] or clean["benefit"][:120],
        "documents": [" ".join(str(d).split())[:80] for d in (data.get("documents") or []) if str(d).strip()][:8],
        "questions": [" ".join(str(q).split())[:200] for q in (data.get("questions") or []) if str(q).strip()][:4],
        "sources": [str(s)[:300] for s in (data.get("sources") or []) if str(s).strip()][:4],
        "created_by": actor_email,
        "created_at": _now_iso(),
        "last_checked": _now_iso()[:10],
    }
    get_database()[CUSTOM_SCHEMES].insert_one(dict(doc))
    doc.pop("org_id")
    return {**doc, "custom": True}


def delete_custom_scheme(org_id: str, scheme_id: str) -> None:
    if not get_database()[CUSTOM_SCHEMES].delete_one({"org_id": org_id, "id": scheme_id}).deleted_count:
        raise UseCaseError("Scheme not found", 404)


def get_survey(survey_id: str | None) -> dict[str, Any] | None:
    return next((s for s in SURVEYS if s["id"] == survey_id), None)


def survey_for(org_id: str, use_case: Any) -> dict[str, Any] | None:
    """The survey an agent runs: its city survey, or its scheme's feedback survey."""
    uc = normalise_use_case(use_case)
    if not uc:
        return None
    if uc["type"] == "city_survey":
        return get_survey(uc["survey_id"])
    if uc["intent"] == "feedback" and uc["scheme_ids"]:
        scheme = next((s for s in catalogue(org_id)["schemes"] if s["id"] == uc["scheme_ids"][0]), None)
        return scheme_feedback_survey(scheme) if scheme else None
    return None


def _schemes_for(org_id: str, scheme_ids: list[str]) -> list[dict[str, Any]]:
    by_id = {s["id"]: s for s in catalogue(org_id)["schemes"]}
    missing = [i for i in scheme_ids if i not in by_id]
    if missing:
        raise UseCaseError(f"Unknown scheme: {', '.join(missing)}")
    return [by_id[i] for i in dict.fromkeys(scheme_ids)]


def _contact(s: dict[str, Any]) -> str:
    """Where to go with a problem: "the helpline X or the official website Y" (empty if neither is known)."""
    parts = []
    if s.get("helpline"):
        parts.append(f"the helpline {s['helpline']}")
    if s.get("website"):
        parts.append(f"the official website {s['website']}")
    return " or ".join(parts)


def _scheme_block(s: dict[str, Any]) -> str:
    kind = KINDS.get(s.get("kind") or "other", KINDS["other"])
    lines = [
        f"### {s['name']}",
        f"Who can get it: {s['eligibility']}",
        f"Benefit: {s['benefit']}",
    ]
    if s.get("documents"):
        lines.append(f"Documents: {', '.join(s['documents'])}.")
    lines.append(f"How to apply: {s['how_to_apply']}")
    contact = f"Official website: {s['website']}" if s.get("website") else ""
    if s.get("helpline"):
        contact += ("; " if contact else "") + f"helpline: {s['helpline']}"
    if contact:
        lines.append(contact + ".")
    if s.get("questions"):
        lines.append("Questions to check if it may fit: " + " ".join(s["questions"]))
    lines.append(f"To check if they're already enrolled, ask: \"{kind['enrolled_question'].format(name=s['name'])}\"")
    lines.append(f"If they're already enrolled: {kind['use']}")
    contact = _contact(s) or "the office named above"
    lines.append(f"If they have a problem: contact {contact}; if that doesn't solve it, the grievance portal {GRIEVANCE_PORTAL}.")
    return "\n".join(lines)


def _voice(org: str, purpose: str) -> str:
    return (
        f"You are a voice assistant calling on behalf of {org} {purpose}. "
        "Speak in the caller's language, warmly and simply, in at most two short sentences at a time."
    )


def _facts(schemes: list[dict[str, Any]]) -> str:
    return (
        "## Schemes you can talk about\nOnly use the facts below and the knowledge base. If the caller asks something "
        "they don't answer, say you don't have that detail and give the official website or helpline.\n\n"
        + "\n\n".join(_scheme_block(s) for s in schemes)
    )


def _knowledge(schemes: list[dict[str, Any]]) -> str:
    """The schemes' built-in knowledge packs (the answers the facts above don't already give)."""
    from app.services.knowledge_packs import prompt_knowledge

    parts = [f"### {s['name']}\n{text}" for s in schemes if (text := prompt_knowledge(s))]
    if not parts:
        return ""
    return (
        "## Knowledge base (built in)\nAnswers from each scheme's VoicEra knowledge pack. Use them as written; "
        "where a source is given, it is the official release the answer was checked against.\n\n" + "\n\n".join(parts)
    )


def _routing(intent: dict[str, Any]) -> str:
    """The section that lets any scheme agent follow another intent's path mid-call."""
    lines = [
        f"## Switch path when the person's situation is different\n"
        f"This call is set up for {intent['name'].lower()}, but you can't know in advance where the person is. "
        "Listen for these cues at any point, follow the matching path, then close the call normally:"
    ]
    for iid, (cue, action) in _PATHS.items():
        name = next(i["name"] for i in INTENTS if i["id"] == iid)
        lines.append(f"- {name}: if {cue}, {action}.")
    lines.append("Switch at most twice in one call, and don't run a path the person doesn't need.")
    return "\n".join(lines)


def _rules(checked: str, *extra: str) -> str:
    rules = [
        "- Never say the person is definitely eligible; say they may be eligible and the office will confirm.",
        "- Never invent amounts, dates, deadlines or rules, and never mention schemes not listed above. For other schemes, suggest myscheme.gov.in.",
        "- Never ask for Aadhaar, bank account, card, OTP or PIN numbers, or any payment. Applying is free; warn them about anyone asking for money to apply.",
        *extra,
        "- If the person says they're not interested or asks you to stop, apologise, thank them and end the call.",
        f"- These facts were last checked on {checked}.",
    ]
    return "## Rules\n" + "\n".join(rules)


def _survey_prompt(org: str, survey: dict[str, Any], *, closing: str, problem_rule: str, extra: tuple[str, ...] = ()) -> str:
    lines = []
    for n, q in enumerate(survey["questions"], start=1):
        kind = {"rating": "rating 1 to 5", "yes_no": "yes or no", "open": "open answer"}[q["kind"]]
        lines.append(f"{n}. [{q['id']}] ({kind}) {q['text']}")
    return "\n\n".join(
        [
            f"You are a voice assistant calling on behalf of {org} to collect citizens' feedback on {survey['topic']}. "
            "Speak in the caller's language, politely and simply, in short sentences.",
            "## How to run the call\n"
            "1. Greet the caller, say who you are and that the survey takes about two minutes, and ask for their consent. If they say no, thank them and end the call.\n"
            "2. Ask the questions below one at a time, in this order, and wait for each answer. Don't skip questions, don't argue and don't suggest answers.\n"
            "3. For the first rating question, explain that 1 means very poor and 5 means very good. If an answer isn't clear, ask once to confirm.\n"
            f"4. After the last question, thank them, say {closing}, and end the call.",
            "## Questions\n" + "\n".join(lines),
            *extra,
            "## Rules\n"
            "- Don't ask for or note their name, address, phone number or any ID number.\n"
            f"- {problem_rule}\n"
            "- If they ask to stop at any point, thank them and end the call.\n"
            "- Keep the whole call under three minutes.",
        ]
    )


def _scheme_preset(org: str, intent: dict[str, Any], schemes: list[dict[str, Any]]) -> dict[str, Any]:
    names = [s["name"] for s in schemes]
    listed = ", ".join(names)
    title = names[0] if len(names) == 1 else f"{len(names)} schemes"
    checked = max(str(s.get("last_checked") or FACTS_CHECKED) for s in schemes)
    s0 = schemes[0]
    kind = KINDS.get(s0.get("kind") or "other", KINDS["other"])
    enrolled_q = kind["enrolled_question"].format(name=s0["name"])
    complaint = _contact(s0) or "the office named in the facts"
    escalate = f"If that doesn't solve it, they can file a complaint on the government grievance portal, {GRIEVANCE_PORTAL}."
    iid = intent["id"]

    if iid == "awareness":
        purpose = "to let citizens know about government schemes that can help them"
        steps = [
            "Greet the caller, say who you are and why you are calling, and ask if this is a good time. If not, offer to call later and end politely.",
            "Say what each scheme gives in one or two sentences, using only the benefit in the facts.",
            "Ask whether they or their family already get it. If they do, switch to the matching path below (already enrolled, or a problem).",
            "If they are interested, say briefly who can get it and how to apply. Don't run a full eligibility check.",
            "Repeat the official website or helpline slowly, thank them and end. Keep the call under two minutes.",
        ]
        welcome = f"Namaste! I'm calling from {org} with information about {names[0] if len(names) == 1 else 'government schemes'} that may help your family. Do you have a minute?"
        agent_purpose = f"Tells citizens about {listed} and where to find out more."
        extra: tuple[str, ...] = ()
    elif iid == "discovery":
        purpose = "to help citizens learn about government schemes they may be eligible for"
        steps = [
            "Greet the caller, say who you are and why you are calling, and ask if this is a good time. If not, offer to call later and end politely.",
            "Ask the questions listed for each scheme, one at a time, to understand which schemes may fit. Don't ask more than four questions in total.",
            "Explain at most two schemes that may fit: the benefit in one sentence, the documents needed and how to apply.",
            "Repeat the official website or helpline slowly, check they have understood, thank them and end the call.",
        ]
        welcome = f"Namaste! I'm calling from {org} about government schemes that may help your family. Is this a good time to talk?"
        agent_purpose = f"Tells citizens about {listed} and how to apply."
        extra = ()
    elif iid == "enrolment":
        purpose = f"to help citizens who may be eligible apply for {s0['name']}"
        steps = [
            f"Greet the caller, say who you are and that you are calling to help them apply for {s0['name']}, and ask if this is a good time.",
            f"Ask: \"{enrolled_q}\" If they already are, switch to the path for people already enrolled below.",
            "Ask the questions listed in the facts, one at a time, to check it may fit. If it clearly doesn't, say so gently, suggest myscheme.gov.in, and end.",
            "Explain how to apply step by step: where to go, the documents to bring (read the list slowly), and that applying is free.",
            "Ask when they plan to apply, repeat the official website or helpline slowly, thank them and end.",
        ]
        welcome = f"Namaste! I'm calling from {org} to help you apply for {s0['name']}. Is this a good time?"
        agent_purpose = f"Helps citizens apply for {s0['name']}, step by step."
        extra = ("- Tell them which documents to bring, but never ask them to read out any document number.",)
    elif iid == "utilisation":
        purpose = f"to make sure people enrolled in {s0['name']} know how to get its benefit"
        steps = [
            f"Greet the caller, say who you are and that you are calling about {s0['name']}, and ask if this is a good time.",
            f"Ask: \"{enrolled_q}\" If not, switch to the Awareness or Enrolment path below.",
            kind["use"],
            f"Ask whether they have had any problem getting the benefit. If they have, listen, say you're sorry, and tell them to contact {complaint}. {escalate}",
            "Check they know their next step, thank them and end.",
        ]
        welcome = f"Namaste! I'm calling from {org} about your {s0['name']} benefit. Is this a good time?"
        agent_purpose = f"Explains to people enrolled in {s0['name']} how to get the benefit."
        extra = ("- Never confirm a payment, claim or hospital on their behalf; point them to the official channel.",)
    elif iid == "support":
        purpose = f"to check whether people enrolled in {s0['name']} have had any problem getting the benefit"
        steps = [
            f"Greet the caller, say who you are and that you are calling to check how {s0['name']} is working for them, and ask if this is a good time.",
            f"Ask: \"{enrolled_q}\" If not, switch to the Awareness or Enrolment path below.",
            "Ask whether they have had any problem getting the benefit. If not, thank them and end.",
            "If they have, listen and ask at most one follow-up question to understand what happened and roughly when. Say you're sorry it happened.",
            f"Tell them what to do: contact {complaint}. {escalate} Say the type of problem will be shared with the office so it can follow up, without any personal details.",
            "Repeat the helpline or website slowly, thank them and end.",
        ]
        welcome = f"Namaste! I'm calling from {org} to check whether you've had any problem with {s0['name']}. Is this a good time?"
        agent_purpose = f"Finds problems people have with {s0['name']} and sends them to the right complaint channel."
        extra = (
            "- Don't argue about whether the problem is real, and don't promise it will be fixed or by when.",
            "- Don't ask for or note their name, address, or any ID, card, account or phone number.",
        )
    else:
        raise UseCaseError("Unknown intent")

    prompt = "\n\n".join(
        [
            _voice(org, purpose),
            _facts(schemes),
            *[k for k in [_knowledge(schemes)] if k],
            "## How to run the call\n" + "\n".join(f"{n}. {step}" for n, step in enumerate(steps, start=1)),
            _routing(intent),
            _rules(checked, *extra),
        ]
    )
    return {
        "name": f"{intent['name']} – {title}" if iid != "discovery" else f"Scheme discovery – {title}",
        "purpose": agent_purpose,
        "welcome": welcome,
        "prompt": prompt,
    }


def build_preset(
    org_id: str,
    *,
    use_case: str,
    intent: str | None = None,
    scheme_ids: list[str] | None = None,
    survey_id: str | None = None,
) -> dict[str, Any]:
    """Name, purpose, opening line and prompt for a new agent of this use case."""
    from app.services import org_service

    org = (org_service.get_organisation(org_id) or {}).get("name") or "the government"
    if use_case in ("scheme", "scheme_discovery"):
        spec = get_intent(intent or "discovery")
        if not spec:
            raise UseCaseError("Pick what the agent is for: awareness, discovery, enrolment, utilisation, support or feedback.")
        schemes = _schemes_for(org_id, list(scheme_ids or []))
        if not schemes:
            raise UseCaseError("Pick at least one scheme.")
        limit = spec["max_schemes"]
        if limit and len(schemes) > limit:
            raise UseCaseError(
                f"A {spec['name'].lower()} agent covers one scheme. Pick one." if limit == 1
                else f"A {spec['name'].lower()} agent covers up to {limit} schemes."
            )
        uc = {"type": "scheme", "intent": spec["id"], "scheme_ids": [s["id"] for s in schemes], "survey_id": None}
        if spec["id"] == "feedback":
            s0 = schemes[0]
            survey = scheme_feedback_survey(s0)
            contact = _contact(s0)
            prompt = _survey_prompt(
                org,
                survey,
                closing="their answers will help the office improve the scheme",
                problem_rule=(
                    f"If they report a problem that needs action, thank them and suggest they contact {contact}, "
                    f"or the grievance portal {GRIEVANCE_PORTAL}." if contact
                    else f"If they report a problem that needs action, thank them and suggest the grievance portal {GRIEVANCE_PORTAL}."
                ),
                extra=(
                    _facts(schemes),
                    *[k for k in [_knowledge(schemes)] if k],
                    _routing(spec)
                    + "\nIf they say they aren't enrolled or never got the benefit, skip the survey and follow the Awareness "
                    "or Enrolment path. If they describe a problem, follow the Support path, then continue the survey if they agree.",
                ),
            )
            return {
                "use_case": uc,
                "name": f"Feedback – {s0['name']}"[:65],
                "purpose": f"Asks people enrolled in {s0['name']} whether the benefit reached them and how the process felt."[:300],
                "welcome": f"Namaste! I'm calling from {org} to hear about your experience with {s0['name']}. It takes about two minutes. Is that okay?",
                "prompt": prompt,
            }
        text = _scheme_preset(org, spec, schemes)
        return {"use_case": uc, **text, "name": text["name"][:65], "purpose": text["purpose"][:300]}
    if use_case == "city_survey":
        survey = get_survey(survey_id)
        if not survey:
            raise UseCaseError("Pick a survey.")
        return {
            "use_case": {"type": "city_survey", "intent": None, "scheme_ids": [], "survey_id": survey["id"]},
            "name": f"City survey – {survey['name']}"[:65],
            "purpose": f"Collects citizens' feedback on {survey['topic']}."[:300],
            "welcome": f"Namaste! I'm calling from {org} to hear your feedback on {survey['topic']}. It takes about two minutes. Is that okay?",
            "prompt": _survey_prompt(
                org,
                survey,
                closing="their feedback will help improve city services",
                problem_rule="If they report a specific problem that needs action, thank them and suggest they also register it with the city's complaint helpline or app.",
            ),
        }
    raise UseCaseError("Choose a scheme agent or a city feedback survey.")

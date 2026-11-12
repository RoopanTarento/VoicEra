import type { ConfigSection } from "../types";

/**
 * Indian languages offered in the configuration. Which of these are voice-ready
 * for a given deployment depends on the speech provider and has to be confirmed;
 * the UI says so wherever languages are chosen.
 */
export const LANGUAGES = [
  "Hindi",
  "English",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Marathi",
  "Bengali",
  "Gujarati",
  "Punjabi",
  "Odia",
  "Assamese",
  "Urdu",
] as const;

export const PHONE_PATTERN = {
  regex: "^\\+?[0-9][0-9 \\-]{7,14}$",
  message: "Enter a phone number with 8 to 15 digits. Spaces and dashes are fine.",
};

export const EMAIL_PATTERN = {
  regex: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
  message: "Enter a valid email address.",
};

/** Identity, language and consent sections shared by every application. */
export function commonSections(opts: { outbound: boolean }): ConfigSection[] {
  return [
    {
      id: "department",
      title: "Department and contacts",
      description: "Who the agent speaks for, and who in your team owns this application.",
      fields: [
        {
          key: "department",
          label: "Department or organisation name",
          kind: "text",
          required: true,
          minLength: 3,
          maxLength: 80,
          placeholder: "For example, Water Supply and Sewerage Board",
          help: "Spoken to the citizen in the opening line.",
        },
        {
          key: "contactName",
          label: "Application owner",
          kind: "text",
          required: true,
          minLength: 3,
          maxLength: 60,
          help: "The person who approves what the agent may say.",
        },
        {
          key: "contactEmail",
          label: "Owner email",
          kind: "text",
          required: true,
          pattern: EMAIL_PATTERN,
        },
      ],
    },
    {
      id: "conversation",
      title: "Language and opening",
      description: "What citizens hear first, and which languages they can choose.",
      fields: [
        {
          key: "languages",
          label: "Languages offered",
          kind: "languages",
          required: true,
          minTags: 1,
          help: "Voice readiness differs by language and provider. Confirm each with the implementation team before launch.",
        },
        {
          key: "agentName",
          label: "Name the agent uses",
          kind: "text",
          required: true,
          maxLength: 40,
          help: "A plain label such as 'the {{department}} assistant' works well.",
        },
        {
          key: "greeting",
          label: "Opening line",
          kind: "textarea",
          required: true,
          minLength: 20,
          maxLength: 300,
          help: "Keep it short. The agent should say who it is and what it can help with.",
        },
        {
          key: "emergencyNotice",
          label: "What the agent says if someone is in danger",
          kind: "textarea",
          required: true,
          minLength: 20,
          maxLength: 300,
          help: "VoicERA applications are not emergency services. Citizens in danger are sent elsewhere straight away.",
        },
      ],
    },
    {
      id: "consent",
      title: "Consent and data",
      description:
        "What the citizen is told before anything is collected, and what the agent is allowed to keep.",
      fields: [
        {
          key: "consentNotice",
          label: "Notice read before collecting anything",
          kind: "textarea",
          required: true,
          minLength: 30,
          maxLength: 400,
          help: "Say that it is an automated assistant, whether the call is recorded, and that the citizen can ask for a person.",
        },
        {
          key: "recording",
          label: "Recording",
          kind: "select",
          required: true,
          options: [
            { value: "none", label: "Do not record" },
            { value: "transcript", label: "Keep the transcript only" },
            { value: "audio", label: "Keep audio and transcript" },
          ],
          help: "Retention and deletion controls are not yet confirmed in the platform, so anything kept stays until it is removed manually.",
        },
      ],
    },
    {
      id: "handoff",
      title: "Human handoff",
      description:
        "A citizen can always ask for a person. This is where that request goes.",
      fields: [
        {
          key: "handoffNumber",
          label: "Number or queue for handoff",
          kind: "text",
          pattern: {
            regex: "^$|^\\+?[0-9][0-9 \\-]{7,14}$",
            message: "Enter a phone number with 8 to 15 digits, or leave blank if nobody is available yet.",
          },
          help: "Leave blank if there is no staffed line yet. The readiness check will flag it.",
        },
        {
          key: "handoffStart",
          label: "Staff available from",
          kind: "time",
        },
        {
          key: "handoffEnd",
          label: "Staff available until",
          kind: "time",
        },
        {
          key: "handoffOutside",
          label: "What the agent says outside those hours",
          kind: "textarea",
          maxLength: 300,
          help: "For example, offer a callback or point to another channel.",
        },
      ],
    },
    ...(opts.outbound
      ? [
          {
            id: "calling",
            title: "Calling rules",
            description: "Applies to calls VoicERA places to citizens.",
            fields: [
              {
                key: "callStart",
                label: "Do not call before",
                kind: "time" as const,
                required: true,
              },
              {
                key: "callEnd",
                label: "Do not call after",
                kind: "time" as const,
                required: true,
              },
              {
                key: "maxAttempts",
                label: "Maximum attempts per citizen",
                kind: "number" as const,
                required: true,
                min: 1,
                max: 5,
              },
              {
                key: "retryGapHours",
                label: "Hours between attempts",
                kind: "number" as const,
                required: true,
                min: 1,
                max: 72,
              },
            ],
          },
        ]
      : []),
  ];
}

export const COMMON_DEFAULTS = {
  department: "",
  contactName: "",
  contactEmail: "",
  languages: ["Hindi", "English"],
  agentName: "Citizen assistant",
  greeting: "Hello, this is the {{department}} assistant. I can help you with your request.",
  consentNotice:
    "This is an automated assistant for {{department}}. Your call may be recorded to help resolve your request. You can ask for a person at any time.",
  recording: "transcript",
  emergencyNotice:
    "If anyone is in danger, please hang up and call 112 now. This service cannot send help.",
  handoffNumber: "",
  handoffStart: "10:00",
  handoffEnd: "17:00",
  handoffOutside:
    "Our staff are not available right now. I can note your request and someone will call you back during working hours.",
  callStart: "09:00",
  callEnd: "19:00",
  maxAttempts: 3,
  retryGapHours: 4,
};

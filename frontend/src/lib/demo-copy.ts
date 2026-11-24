/** Per-template wording for the demo builder's questions. The question titles
 * themselves (q1, q2, q3) come from the knowledge base's Templates tab. */

export type Job = "ANSWER" | "INFORM" | "GUIDE" | "REMIND" | "COLLECT" | "RESOLVE";

export interface QuestionCopy {
  /** Q1's own field, under the sector tiles. */
  field: { label: string; placeholder: string; long?: boolean; required?: boolean };
  /** The line under Q2's title. */
  q2Note: (sector: string) => string;
}

export const COPY: Record<Job, QuestionCopy> = {
  ANSWER: {
    field: { label: "In one line, what should it help with?", placeholder: "Not listed above? Just describe it here." },
    q2Note: (sector) =>
      `We've loaded verified sample knowledge for ${sector}. You can add your own documents too; they're deleted after the session.`,
  },
  INFORM: {
    field: {
      label: "The announcement",
      placeholder: "What is happening, where and when, and what people should do. Paste it here.",
      long: true,
      required: true,
    },
    q2Note: () => "The agent tells them who the message is for, then answers questions only from it.",
  },
  GUIDE: {
    field: { label: "Which service, in a few words?", placeholder: "e.g. income certificate, new water connection" },
    q2Note: () => "The steps and documents come from the official process. Pick the service the agent should walk people through.",
  },
  REMIND: {
    field: {
      label: "What's due, and by when?",
      placeholder: "e.g. Child's measles vaccine, due 28 Nov at PHC Hosakote",
      long: true,
      required: true,
    },
    q2Note: () => "What the agent offers when someone says they can't make it.",
  },
  COLLECT: {
    field: { label: "What is it for?", placeholder: "e.g. Feedback after a hospital stay" },
    q2Note: (sector) => `A suggested set for ${sector}. Edit, add or remove questions; the agent asks one per turn.`,
  },
  RESOLVE: {
    field: { label: "In one line, what kind of complaints?", placeholder: "e.g. Potholes and garbage in my ward" },
    q2Note: () => "Untick any complaint type the agent shouldn't take. Each one goes to the office shown.",
  },
};

export function jobOf(job: string): Job {
  return (["ANSWER", "INFORM", "GUIDE", "REMIND", "COLLECT", "RESOLVE"] as const).includes(job as Job) ? (job as Job) : "ANSWER";
}

/** "Topics asked" values may be a list; show them on one line. */
export function showValue(value: string | string[] | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(" · ") : "—";
  const v = value.trim();
  if (!v) return "—";
  return v.length <= 3 && /^(yes|no)$/i.test(v) ? v[0].toUpperCase() + v.slice(1).toLowerCase() : v;
}

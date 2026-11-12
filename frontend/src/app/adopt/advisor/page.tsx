import type { Metadata } from "next";
import { Container, PageIntro } from "@/components/adopt/ui";
import { AdvisorStart } from "@/components/adopt/advisor/AdvisorStart";

export const metadata: Metadata = { title: "Package advisor" };

export default function AdvisorPage() {
  return (
    <Container>
      <PageIntro eyebrow="Package advisor" title="What are you trying to achieve for your department or citizens?">
        <p>
          Tell us in your own words, pick a use case, or explore by sector. We then ask only the questions that matter for what you chose, check them
          against the VoicEra Fully Loaded (Platinum) package as documented, and tell you plainly what fits and what does not.
        </p>
      </PageIntro>
      <div className="pt-8">
        <AdvisorStart />
      </div>
    </Container>
  );
}

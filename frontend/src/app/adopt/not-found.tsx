import Link from "next/link";
import { Container, LinkButton } from "@/components/adopt/ui";

export default function AdoptNotFound() {
  return (
    <Container narrow>
      <div className="flex flex-col items-start gap-4 py-20">
        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-v-muted">Not found</span>
        <h1 className="text-[32px] font-semibold tracking-tight">We could not find that page</h1>
        <p className="max-w-[52ch] text-[15px] leading-relaxed text-v-body">
          The link may be out of date. Try one of the main sections, or go back to the start.
        </p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/adopt">Back to the start</LinkButton>
          <LinkButton href="/adopt/applications" variant="outline">Browse applications</LinkButton>
          <Link href="/adopt/help" className="inline-flex items-center px-3 py-[11px] text-[13px] font-semibold text-v-accent hover:underline">Help</Link>
        </div>
      </div>
    </Container>
  );
}

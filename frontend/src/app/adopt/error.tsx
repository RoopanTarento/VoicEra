"use client";

import { Button } from "@/components/ui/Button";
import { Container, Notice } from "@/components/adopt/ui";

export default function AdoptError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container narrow>
      <div className="flex flex-col gap-4 py-16">
        <h1 className="text-[28px] font-semibold tracking-tight">Something went wrong on this page</h1>
        <Notice tone="danger">
          The page could not be shown. Your saved answers have not been lost. Try again, or go back to the start.
        </Notice>
        <div className="flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <a href="/adopt" className="inline-flex items-center rounded-v-md border border-v-line-strong px-[17px] py-[11px] text-[13px] font-semibold">Back to the start</a>
        </div>
      </div>
    </Container>
  );
}

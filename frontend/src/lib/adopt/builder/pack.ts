import { buildDeck, deckToMarkdown } from "./deck";
import { handoverFiles, type PackInput } from "./deploy";
import { buildQuote, quoteToCsv, quoteToMarkdown } from "./quote";

/**
 * The full hand-over pack: the seven working files, plus the whole pitch deck and the itemised quote,
 * the two documents a department is most likely to share inside its own organisation.
 */
export function buildPack(i: PackInput, now: Date = new Date()): { name: string; content: string }[] {
  const base = handoverFiles(i);
  const deck = buildDeck(i.profile, i.pb, i.sel, now);
  const quote = buildQuote(i.sel, i.pb, now);
  return [
    ...base,
    { name: "07-pitch-deck.md", content: deckToMarkdown(deck) },
    { name: "08-itemised-quote.csv", content: quoteToCsv(quote) },
    { name: "09-itemised-quote.md", content: quoteToMarkdown(quote, i.profile.department) },
  ];
}

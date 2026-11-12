import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as api from "../api";
import { dropCache, resetDb } from "../db";
import { useMemoryStorage } from "../storage";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../seed";
import { buildQuote, quoteCsv, quotePdf } from "../quote";

beforeEach(async () => { useMemoryStorage(); dropCache(); api.configureApi({ latency: 0, jitter: 0 }); await resetDb(); });

test("the quote document, CSV and PDF carry the same numbers", async () => {
  const pm = DEMO_ACCOUNTS.find((a) => a.role === "product_manager")!;
  await api.signIn({ email: pm.email, password: DEMO_PASSWORD, remember: false });
  const p = await api.ensureQuote("pk-sample");
  const org = { name: "Directorate of Citizen Services (sample)" };
  const d = buildQuote(p, org)!;
  assert.ok(d.numbers.recurring > 0);
  assert.equal(d.cost.rows.length, 7);
  const csv = quoteCsv(d);
  assert.ok(csv.includes(String(d.numbers.recurring)), "CSV has the recurring total");
  const money = csv.split("\r\n").filter((l) => l.startsWith("Cost per month,") || l.startsWith("Cost one-time,"));
  assert.ok(money.length >= 8 && money.every((l) => !l.split(",")[2].includes("₹")), "cost rows are plain numbers a spreadsheet can add up");
  const blob = await quotePdf(d);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const pages = (buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pages >= 1 && pages <= 3, `a one-configuration quote should fit in 3 pages, got ${pages}`);
  if (process.env.VANI_PDF_OUT) writeFileSync(process.env.VANI_PDF_OUT, buf);
});

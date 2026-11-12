import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { evaluate } from "../evaluate";
import { defaultCostInput } from "../cost";
import { emptyPoc, generateKnowledgeFiles, generateScript, hasBlocking, pocToAnswers, pocToWorkspaceConfig, samplePoc, validatePoc, type PocScheme } from "../poc";
import { crc32, makeZip } from "../zip";
import { emptyAnswers } from "../usecases";
import { setValue } from "../answers";

const scheme = (i: number): PocScheme => ({
  id: `s${i}`,
  name: `Scheme number ${i}`,
  summary: "A short summary.",
  eligibility: "Residents of the district who meet the stated conditions.",
  documents: "Proof of residence.",
  howToApply: "At the district office.",
  deadline: "",
});

describe("scheme discovery PoC builder", () => {
  it("starts empty and blocked, and the worked example is valid and labelled as an example", () => {
    assert.equal(hasBlocking(emptyPoc()), true);
    const s = samplePoc();
    assert.equal(s.example, true);
    assert.equal(hasBlocking(s), false);
    assert.ok(s.schemes.every((x) => x.name.includes("(sample)")));
  });

  it("validates each field with a message", () => {
    const p = { ...samplePoc(), department: "", schemes: [{ ...scheme(1), name: "", eligibility: "x" }, scheme(1), scheme(1)] };
    const msgs = validatePoc(p).map((i) => i.message);
    assert.ok(msgs.some((m) => m.includes("department")));
    assert.ok(msgs.some((m) => m.includes("enter a name")));
    assert.ok(msgs.some((m) => m.includes("used twice")));
  });

  it("generates a script with the introduction, questions, fallbacks and closing", () => {
    const blocks = generateScript(samplePoc());
    const titles = blocks.map((b) => b.title);
    assert.ok(titles.includes("Introduction"));
    assert.ok(titles.includes("Hold message"));
    assert.ok(titles.includes("When it cannot tell"));
    assert.ok(titles.includes("Closing"));
    assert.ok(blocks.filter((b) => b.title.startsWith("Question")).length === 2);
    assert.ok(blocks[0].text.includes("Sample Agriculture Department"));
  });

  it("keeps knowledge files inside the package limits, whatever the number of schemes", () => {
    for (const n of [1, 3, 8, 20, 60]) {
      const p = { ...samplePoc(), schemes: Array.from({ length: n }, (_, i) => scheme(i + 1)) };
      const { files, problems } = generateKnowledgeFiles(p);
      assert.ok(files.length <= 10, `${n} schemes gave ${files.length} files`);
      assert.deepEqual(problems, []);
      for (const f of files) {
        assert.ok(f.name.endsWith(".txt"));
        assert.ok(f.bytes <= 5 * 1024 * 1024);
      }
    }
  });

  it("reports a file that is over 5 MB", () => {
    const big = { ...scheme(1), eligibility: "x".repeat(5 * 1024 * 1024 + 10) };
    const { problems } = generateKnowledgeFiles({ ...samplePoc(), schemes: [big] });
    assert.ok(problems.some((m) => m.includes("5 MB")));
  });

  it("maps the PoC onto the existing Scheme Discovery workspace configuration", () => {
    const cfg = pocToWorkspaceConfig(samplePoc());
    assert.equal(cfg.department, "Sample Agriculture Department");
    assert.equal((cfg.schemes as unknown[]).length, 2);
    assert.equal((cfg.questions as unknown[]).length, 2);
    assert.ok(String(cfg.greeting).includes("Sample Agriculture Department"));
  });

  it("pre-fills the advisor honestly: generated material is a draft and unapproved, not ready", () => {
    const a = pocToAnswers(samplePoc(), emptyAnswers());
    assert.equal(a.values.objective, "scheme-discover");
    assert.equal(a.values.scriptStatus, "draft");
    assert.equal(a.values.kbStatus, "unapproved");
    assert.equal(a.origin.kbStatus, "interpreted");
    const f = a.values.kbFiles as { count: number; formats: string[] };
    assert.ok(f.count >= 3 && f.count <= 10);
    assert.deepEqual(f.formats, ["Text"]);
    const ev = evaluate(setValue(a, "direction", "inbound"))!;
    assert.equal(ev.dimensions.find((d) => d.id === "knowledge")!.result, "conditional");
  });

  it("starts the cost estimator from answers without assuming anything else", () => {
    const base = defaultCostInput(emptyAnswers());
    assert.deepEqual(base, { numbers: null, minutes: null, minutesIsAssumption: false, category: "unknown" });
    let a = setValue(emptyAnswers(), "objective", "scheme-discover");
    a = setValue(a, "direction", "inbound");
    a = setValue(a, "numberSource", "new");
    a = setValue(a, "callsPerMonth", 1000);
    a = setValue(a, "avgMinutes", 2);
    const d = defaultCostInput(a);
    assert.equal(d.numbers, 1);
    assert.equal(d.minutes, 2000);
    assert.equal(d.category, "unknown");
  });
});

describe("zip writer", () => {
  it("computes a correct CRC-32", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });

  it("produces an archive that a real unzip accepts and extracts to the same text", () => {
    const files = generateKnowledgeFiles(samplePoc()).files;
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const path = join(dir, "kb.zip");
    writeFileSync(path, makeZip(files));
    let tool = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      tool = false;
    }
    if (!tool) return;
    const listing = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
    assert.ok(/No errors detected/.test(listing), listing);
    const first = execFileSync("unzip", ["-p", path, files[0].name], { encoding: "utf8" });
    assert.equal(first, files[0].content);
  });
});

import { describe, it, expect } from "vitest";
import { simulateAiText } from "@/lib/ai/simulated";

describe("simulateAiText", () => {
  it("is deterministic: same prompt → identical output", async () => {
    const a = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    const b = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    expect(a.text).toBe(b.text);
  });

  it("marks output as simulated and echoes a prompt fragment", async () => {
    const r = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    expect(r.text.startsWith("[simulated]")).toBe(true);
    expect(r.text).toContain("Summarize Q3 revenue".slice(0, 24));
    expect(r.model).toBe("simulated");
  });

  it("distinct prompts → distinct outputs", async () => {
    const a = await simulateAiText({ feature: "smoke-test", prompt: "alpha" });
    const b = await simulateAiText({ feature: "smoke-test", prompt: "beta" });
    expect(a.text).not.toBe(b.text);
  });
});

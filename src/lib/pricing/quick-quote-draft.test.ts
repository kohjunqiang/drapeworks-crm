import { describe, expect, it } from "vitest";
import { calculatorDefaults, newCalculatorWindow } from "@/lib/validation/pricing-calculator";
import { clearQuickQuoteDraft, createQuickQuoteDraftStore, readQuickQuoteDraft, writeQuickQuoteDraft } from "./quick-quote-draft";
const draft = () => ({ values: { ...calculatorDefaults, rooms: [{ id: "room", label: "Living Room", windows: [{ ...newCalculatorWindow("window"), width: "321" }] }] }, override: "987" });

describe("unsaved calculator tab memory", () => {
  it("restores rooms and the final override after leaving and reentering", () => {
    const memory = createQuickQuoteDraftStore(); memory.write("consultant", draft());
    expect(memory.read("consultant")).toEqual(draft());
  });
  it("isolates authenticated profiles", () => {
    const memory = createQuickQuoteDraftStore(); memory.write("consultant-a", draft());
    expect(memory.read("consultant-b")).toBeNull();
    memory.write("consultant-b", { ...draft(), override: "700" });
    expect(memory.read("consultant-a")?.override).toBe("987");
  });
  it("reset clears only the current profile's draft", () => {
    const memory = createQuickQuoteDraftStore(); memory.write("a", draft()); memory.write("b", draft()); memory.clear("a");
    expect(memory.read("a")).toBeNull(); expect(memory.read("b")).not.toBeNull();
  });
  it.each([null, "", "0", "-10", "12.", "invalid"])("preserves raw final input %s without fallback", (override) => {
    const memory = createQuickQuoteDraftStore(); memory.write("a", { ...draft(), override });
    expect(memory.read("a")?.override).toBe(override);
  });
  it("clones both writes and reads, including nested rooms/windows/add-ons", () => {
    const memory = createQuickQuoteDraftStore(); const input = draft(); memory.write("a", input);
    input.values.rooms[0].windows[0].width = "999";
    const read = memory.read("a")!; expect(read.values.rooms[0].windows[0].width).toBe("321");
    read.values.rooms[0].windows[0].addonIds.push("mutated");
    expect(memory.read("a")!.values.rooms[0].windows[0].addonIds).toEqual([]);
  });
  it("does not retain user draft data in the server module singleton", () => {
    writeQuickQuoteDraft("server-user", draft());
    expect(readQuickQuoteDraft("server-user")).toBeNull();
    expect(() => clearQuickQuoteDraft("server-user")).not.toThrow();
  });
});

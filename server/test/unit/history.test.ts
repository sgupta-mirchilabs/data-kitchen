import { describe, it, expect } from "vitest";
import { serializeHistoryValue, diffProductFields } from "../../src/services/history.js";

describe("serializeHistoryValue", () => {
  it("serializes strings as-is", () => {
    expect(serializeHistoryValue("Vietnam")).toBe("Vietnam");
  });

  it("serializes numbers to string", () => {
    expect(serializeHistoryValue(1.82)).toBe("1.82");
  });

  it("serializes booleans to string", () => {
    expect(serializeHistoryValue(true)).toBe("true");
    expect(serializeHistoryValue(false)).toBe("false");
  });

  it("serializes null to SQL NULL", () => {
    expect(serializeHistoryValue(null)).toBeNull();
  });

  it("serializes undefined to SQL NULL", () => {
    expect(serializeHistoryValue(undefined)).toBeNull();
  });

  it("serializes arrays to JSON string", () => {
    expect(serializeHistoryValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes objects to JSON string", () => {
    expect(serializeHistoryValue({ weight: 1.82, unit: "lbs" })).toBe('{"weight":1.82,"unit":"lbs"}');
  });
});

describe("diffProductFields", () => {
  it("detects changed scalar fields", () => {
    const existing = { brand: "Acme", category: "Tools" };
    const incoming = { brand: "Acme Inc", category: "Tools" };
    const changes = diffProductFields(existing, incoming);

    expect(changes.length).toBe(1);
    expect(changes[0].field).toBe("brand");
    expect(changes[0].previousValue).toBe("Acme");
    expect(changes[0].newValue).toBe("Acme Inc");
  });

  it("detects null → value transitions", () => {
    const existing = { brand: null };
    const incoming = { brand: "Acme" };
    const changes = diffProductFields(existing, incoming);

    expect(changes.length).toBe(1);
    expect(changes[0].previousValue).toBeNull();
    expect(changes[0].newValue).toBe("Acme");
  });

  it("ignores null incoming values (non-empty-only updates)", () => {
    const existing = { brand: "Acme" };
    const incoming = { brand: null };
    const changes = diffProductFields(existing, incoming);

    expect(changes.length).toBe(0);
  });

  it("supports dot-notation prefixes for nested fields", () => {
    const existing = { net_weight: "1.82" };
    const incoming = { net_weight: "2.0" };
    const changes = diffProductFields(existing, incoming, "packaging");

    expect(changes[0].field).toBe("packaging.net_weight");
  });

  it("detects object-valued field changes", () => {
    const existing = { dims: { w: 10, h: 20 } };
    const incoming = { dims: { w: 10, h: 25 } };
    const changes = diffProductFields(existing, incoming);

    expect(changes.length).toBe(1);
    expect(changes[0].field).toBe("dims");
  });

  it("returns empty array when nothing changed", () => {
    const existing = { brand: "Acme", sku: "ABC" };
    const incoming = { brand: "Acme", sku: "ABC" };
    const changes = diffProductFields(existing, incoming);

    expect(changes.length).toBe(0);
  });
});

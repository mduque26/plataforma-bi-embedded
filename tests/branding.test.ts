import { describe, expect, it } from "vitest";
import { normalizeTheme } from "../src/branding";

describe("tenant branding", () => {
  it("normalizes editable white-label properties", () => {
    expect(normalizeTheme({
      productName: "  Portal Cliente  ", logoText: "pc", accent: "#123ABC", radius: 99,
    })).toMatchObject({ productName: "Portal Cliente", logoText: "PC", accent: "#123ABC", radius: 24 });
  });

  it("rejects unsafe colors and preserves existing values", () => {
    expect(normalizeTheme({ accent: "red; color: black" }, { accent: "#0f766e" })).toEqual({ accent: "#0f766e" });
  });
});

import { it, expect } from "vitest";
import { toCents, fromCents } from "./types";
it("uses exact integer cents", () => {
  expect(toCents("110.01")).toBe(11001);
  expect(fromCents(11001)).toBe("110.01");
  for (const v of ["1.001", "-1", "NaN"]) expect(() => toCents(v)).toThrow();
  expect(() => fromCents(1.2)).toThrow();
});

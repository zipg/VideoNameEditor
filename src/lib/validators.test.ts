import { describe, expect, it } from "vitest";
import { validateBatchInput } from "./validators";

describe("validateBatchInput", () => {
  it("rejects ratio over 2", () => {
    expect(validateBatchInput("0.1", "0.1", "2.1", "1", 10)).toBe("ratio_out_of_range");
  });

  it("rejects cut sum >= duration", () => {
    expect(validateBatchInput("3", "2", "1.2", "1", 5)).toBe("cut_exceeds_duration");
  });

  it("accepts valid values", () => {
    expect(validateBatchInput("0.5", "1.2", "1.25", "3", 10)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { initialState, reducer } from "./reducer";

describe("guard state", () => {
  it("sets hasPartialFailure when rename summary contains failed > 0", () => {
    const next = reducer(initialState, { type: "RENAME_FINISHED", success: 3, failed: 1 });
    expect(next.guard.hasPartialFailure).toBe(true);
  });
});

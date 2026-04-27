import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("shows batch parse button", () => {
    render(<App />);
    expect(screen.getByText("批量解析")).toBeInTheDocument();
  });
});

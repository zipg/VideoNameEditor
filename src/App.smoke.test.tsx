import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("shows app title and page switch", () => {
    render(<App />);
    expect(screen.getByText("视频批处理工具")).toBeInTheDocument();
    expect(screen.getByText("文件名处理")).toBeInTheDocument();
    expect(screen.getByText("分辨率处理")).toBeInTheDocument();
  });
});

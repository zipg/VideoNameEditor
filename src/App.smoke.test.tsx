import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App, { parseMediaFileName } from "./App";

describe("App", () => {
  it("shows page title and page switch", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "视频文件名" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "视频文件名" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "视频分辨率" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "图片/音乐文件名" })).toBeInTheDocument();
  });

  it("parses existing media categories from file name", () => {
    expect(parseMediaFileName("封面图-搞笑&教程.png")).toEqual({
      fileName: "封面图-搞笑&教程.png",
      baseName: "封面图",
      extension: ".png",
      categories: "搞笑\n教程",
    });
  });
});


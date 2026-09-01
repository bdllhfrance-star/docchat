import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "./page";

test("renders the DocChat workspace", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { level: 1, name: "DocChat" }),
  ).toBeDefined();
  expect(screen.getByText("Workspace ready")).toBeDefined();
});

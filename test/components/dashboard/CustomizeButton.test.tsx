import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSettings } from "@/store/settings";
import { CustomizeButton } from "@/components/dashboard/CustomizeButton";

describe("CustomizeButton", () => {
  beforeEach(() => useSettings.setState({ editMode: false, dashboardLayout: null } as never));
  it("toggles editMode on click", () => {
    render(<CustomizeButton />);
    expect(useSettings.getState().editMode).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /customize/i }));
    expect(useSettings.getState().editMode).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(useSettings.getState().editMode).toBe(false);
  });
});

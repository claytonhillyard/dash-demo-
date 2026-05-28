import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortablePanel } from "@/components/dashboard/SortablePanel";

function wrap(children: React.ReactNode) {
  return (
    <DndContext>
      <SortableContext items={["a"]}>{children}</SortableContext>
    </DndContext>
  );
}

describe("SortablePanel", () => {
  it("renders children and no edit controls when editMode=false", () => {
    render(wrap(
      <SortablePanel id="a" size={1} editMode={false}
        onCycleSize={vi.fn()} onToggleHidden={vi.fn()}>
        <div>content</div>
      </SortablePanel>
    ));
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByLabelText(/move panel/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cycle size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/hide panel/i)).not.toBeInTheDocument();
  });

  it("renders drag handle + size cycle + hide buttons when editMode=true", () => {
    const onCycleSize = vi.fn();
    const onToggleHidden = vi.fn();
    render(wrap(
      <SortablePanel id="a" size={1} editMode={true}
        onCycleSize={onCycleSize} onToggleHidden={onToggleHidden}>
        <div>content</div>
      </SortablePanel>
    ));
    expect(screen.getByLabelText(/move panel/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/cycle size/i));
    expect(onCycleSize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(/hide panel/i));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
  });
});

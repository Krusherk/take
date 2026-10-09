import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WheelDateTimePicker, parseLocal, timeZoneLabel, toLocal } from "./WheelDateTimePicker";

const now = new Date(2026, 9, 9, 13, 2);

function Harness({ initial, hour12 = true, onChange }: { initial: string; hour12?: boolean; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <WheelDateTimePicker label="Nominations end" value={value} now={now} hour12={hour12} onChange={(next) => { setValue(next); onChange?.(next); }} />;
}

describe("WheelDateTimePicker", () => {
  it("exposes one spinbutton per wheel with readable values and the time zone", () => {
    render(<Harness initial="2026-10-16T13:15" />);
    expect(screen.getByRole("group", { name: /Nominations end/ })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Nominations end, day" })).toHaveAttribute("aria-valuetext", "Friday, October 16, 2026");
    expect(screen.getByRole("spinbutton", { name: "Nominations end, hour" })).toHaveAttribute("aria-valuetext", "1");
    expect(screen.getByRole("spinbutton", { name: "Nominations end, minute" })).toHaveAttribute("aria-valuetext", "15");
    expect(screen.getByRole("spinbutton", { name: "Nominations end, AM or PM" })).toHaveAttribute("aria-valuetext", "PM");
    expect(screen.getByText(timeZoneLabel(parseLocal("2026-10-16T13:15")!))).toBeInTheDocument();
  });

  it("keeps the datetime-local string format as keys move each wheel", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-16T13:15" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, day" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-17T13:15");
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, minute" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-17T13:10");
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, AM or PM" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-17T01:10");
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, hour" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-17T00:10");
  });

  it("wraps minutes and hours, but not days", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-09T23:55" hour12={false} onChange={onChange} />);
    expect(screen.queryByRole("spinbutton", { name: /AM or PM/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, minute" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-09T23:00");
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Nominations end, day" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("selects a row on click and shows the relative time", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-09T15:00" hour12={false} onChange={onChange} />);
    expect(screen.getByText(/in 2 hours/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-10T15:00");
  });

  it("round-trips local strings", () => {
    expect(toLocal(parseLocal("2026-12-31T23:55")!)).toBe("2026-12-31T23:55");
    expect(parseLocal("not a date")).toBeNull();
  });
});

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { StaffRole } from "@/lib/types";

const COPY: Partial<Record<StaffRole, { title: string; steps: string[] }>> = {
  CASHIER: {
    title: "Your counter",
    steps: [
      "Tap the menu to build the ticket.",
      "Send it to kitchen first so they can start cooking.",
      "Take cash whenever the customer pays.",
      "Hand the order over only when kitchen marks it ready.",
    ],
  },
  KITCHEN: {
    title: "Your pass",
    steps: [
      "You only see food — never money.",
      "New tickets wait on the left. Start the oldest one first.",
      "When the plate can leave, mark it ready for the counter.",
      "If a ticket turns red, it has been waiting too long.",
    ],
  },
  MANAGER: {
    title: "Your floor",
    steps: [
      "Open the cash shift before anyone sells.",
      "Watch unpaid tickets and cancel only what never got cooked.",
      "Receive, count or waste stock as it really is.",
      "Close the shift with a physical drawer count.",
    ],
  },
};

export function FirstShiftGuide({ role }: { role: StaffRole }) {
  const key = `plugos.firstShift.${role}`;
  const copy = COPY[role];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(window.localStorage.getItem(key) !== "1");
  }, [key]);

  if (!copy || !open) return null;

  return (
    <aside className="rounded-xl border border-signal/40 bg-signal-soft/20 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">First shift</p>
      <h2 className="mt-2 font-display text-2xl font-medium">{copy.title}</h2>
      <ol className="mt-3 space-y-2 text-sm leading-6">
        {copy.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="font-mono text-xs tabular-nums text-muted">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <Button
        className="mt-4"
        variant="ink"
        type="button"
        onClick={() => {
          window.localStorage.setItem(key, "1");
          setOpen(false);
        }}
      >
        Got it — start the shift
      </Button>
    </aside>
  );
}

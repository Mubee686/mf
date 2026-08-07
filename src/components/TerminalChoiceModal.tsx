/**
 * OpenTerminalButton — renders an "Open Terminal" button that opens a modal
 * letting the user choose between the Forex terminal and the Futures terminal.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BarChart2, LineChart, X } from "lucide-react";

export function TerminalChoiceModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a terminal"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-[#1E3A6E] bg-[#0D1F3C] p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-bold text-white">Choose your terminal</h2>
        <p className="mt-1 text-sm text-[#7BA8CC]">
          Both terminals include the full Smart Money Concepts toolkit.
        </p>

        <div className="mt-5 grid gap-3">
          <Link
            to="/terminal"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl border border-[#2563EB] bg-[#2563EB] px-4 py-3.5 text-left font-bold text-white transition-colors hover:bg-[#1D4ED8]"
          >
            <LineChart className="h-5 w-5 shrink-0" />
            <span>
              Forex Terminal
              <span className="block text-xs font-medium opacity-80">
                Majors, crosses &amp; gold — live SMC analysis
              </span>
            </span>
          </Link>

          <Link
            to="/futures"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl border border-[#1E3A6E] bg-[#0A1428] px-4 py-3.5 text-left font-bold text-white transition-colors hover:bg-[#1A3560]"
          >
            <BarChart2 className="h-5 w-5 shrink-0 text-[#60A5FA]" />
            <span>
              Futures Terminal
              <span className="block text-xs font-medium text-[#7BA8CC]">
                All crypto futures pairs — live price &amp; candle timer
              </span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function OpenTerminalButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children ?? (
          <>
            <BarChart2 className="h-4 w-4" />
            Open Terminal
          </>
        )}
      </button>
      {open && <TerminalChoiceModal onClose={() => setOpen(false)} />}
    </>
  );
}

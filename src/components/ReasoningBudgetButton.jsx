import { useState, useRef, useEffect } from "react";
import BrainIcon from "./icons/BrainIcon";

function ChevronDown({ className, style }) {
  return (
    <svg className={className} style={style} width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 9l6 6 6-6"/></svg>
  );
}

function ChevronUp({ className, style }) {
  return (
    <svg className={className} style={style} width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 15l-6-6-6 6"/></svg>
  );
}

export default function ReasoningBudgetButton({
  reasonEnabled,
  onToggleReason,
  thinkingBudget,
  onBudgetChange,
  min = 50,
  max = 16384,
  step = 50,
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false); 
  const popoverRef = useRef(null);
  const chevronRef = useRef(null);
  const fadeDuration = 180; 

  useEffect(() => {
    if (open) {
      setVisible(true);
    } else if (visible) {
      const timeout = setTimeout(() => setVisible(false), fadeDuration);
      return () => clearTimeout(timeout);
    }
  }, [open, visible]);

  useEffect(() => {
    function handleClick(e) {
      if (
        open &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        chevronRef.current &&
        !chevronRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative flex items-center">
      <button
        onClick={onToggleReason}
        className={`flex items-center px-3 py-1.5 rounded-lg transition-all duration-200 font-medium focus:outline-none ${reasonEnabled ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-white shadow w-11" : "bg-transparent text-neutral-700 dark:text-neutral-200 w-10"}`}
        style={{ minWidth: reasonEnabled ? 44 : 40, maxWidth: 44 }}
      >
        <span className={`transition-all duration-200 ${reasonEnabled ? "scale-110" : "scale-100"}`}>
          <BrainIcon className="h-5 w-5" />
        </span>
      </button>
      {reasonEnabled && (
        <span
          ref={chevronRef}
          className="ml-1 flex items-center cursor-pointer user-select-none"
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        >
          <ChevronDown
            className="h-4 w-4 transition-transform duration-200"
            style={{ transform: open ? "rotate(-180deg)" : "rotate(0deg)" }}
          />
        </span>
      )}
      {visible && reasonEnabled && (
        <div
          ref={popoverRef}
          className={`absolute left-1/2 bottom-12 -translate-x-1/2 z-50 w-80 bg-neutral-900 text-white rounded-xl shadow-xl p-5 transition-opacity duration-200 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          style={{ minWidth: 320, transition: `opacity ${fadeDuration}ms` }}
        >
          <div className="font-semibold text-base mb-1">Thinking budget</div>
          <div className="text-sm text-neutral-300 mb-4">Control the maximum length of thinking.</div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={thinkingBudget}
            onChange={e => onBudgetChange(parseInt(e.target.value))}
            className="w-full accent-white h-2 rounded-lg appearance-none cursor-pointer bg-neutral-700"
            style={{ background: "#444" }}
          />
          <div className="mt-3 flex justify-between items-center">
            <span className="text-lg font-bold text-white">{thinkingBudget.toLocaleString()} tokens</span>
          </div>
        </div>
      )}
    </div>
  );
} 
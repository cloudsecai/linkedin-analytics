import { useState } from "react";
import type { GenCoachingChange } from "../../../api/client";

interface CoachingChangeCardProps {
  change: GenCoachingChange;
  onDecide: (action: string, editedText?: string) => void;
  decided?: boolean;
}

export default function CoachingChangeCard({ change, onDecide, decided }: CoachingChangeCardProps) {
  const [editedNewText, setEditedNewText] = useState(change.new_text || "");

  return (
    <div
      className="bg-gen-bg-2 border border-gen-border-1 rounded-xl overflow-hidden transition-opacity"
      style={decided ? { opacity: 0.5, pointerEvents: "none" } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-[18px] py-[14px]">
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-[3px] rounded-[5px] text-[10px] font-bold uppercase tracking-[0.6px] bg-gen-bg-3 text-gen-text-2 border border-gen-border-2">
            {change.type}
          </span>
          <span className="text-[14px] font-medium text-gen-text-0">{change.title}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-[18px] pb-4">
        {/* NEW card: evidence, then green editable block */}
        {change.type === "new" && (
          <>
            <p className="text-[13px] text-gen-text-2 leading-[1.6] mb-3.5">{change.evidence}</p>
            <div
              className="bg-gen-bg-1 border border-gen-border-2 rounded-md px-3.5 py-2.5 mb-3.5 outline-none cursor-text text-[13px] text-gen-text-1 leading-[1.55] hover:border-gen-border-3 focus-within:border-gen-accent-border"
              style={{ borderLeft: "3px solid var(--color-positive)" }}
            >
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setEditedNewText(e.currentTarget.textContent || "")}
                className="outline-none"
              >
                {change.new_text}
              </div>
            </div>
          </>
        )}

        {/* UPDATED card: old (red strikethrough) + new (green editable) + evidence */}
        {change.type === "updated" && (
          <>
            <div
              className="bg-gen-bg-1 border border-gen-border-2 rounded-md px-3.5 py-2.5 mb-2 text-[13px] text-gen-text-3 leading-[1.55] line-through"
              style={{ borderLeft: "3px solid var(--color-negative)" }}
            >
              {change.old_text}
            </div>
            <div
              className="bg-gen-bg-1 border border-gen-border-2 rounded-md px-3.5 py-2.5 mb-3.5 outline-none cursor-text text-[13px] text-gen-text-1 leading-[1.55] hover:border-gen-border-3 focus-within:border-gen-accent-border"
              style={{ borderLeft: "3px solid var(--color-positive)" }}
            >
              <div
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setEditedNewText(e.currentTarget.textContent || "")}
                className="outline-none"
              >
                {change.new_text}
              </div>
            </div>
            <p className="text-[13px] text-gen-text-2 leading-[1.6] mb-3.5">{change.evidence}</p>
          </>
        )}

        {/* RETIRE card: evidence only */}
        {change.type === "retire" && (
          <p className="text-[13px] text-gen-text-2 leading-[1.6] mb-3.5">{change.evidence}</p>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5">
          {change.type === "retire" ? (
            <>
              <button
                onClick={() => onDecide("retire")}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-gen-bg-4 border border-gen-border-3 text-gen-text-0 hover:bg-gen-bg-3 transition-colors cursor-pointer"
              >
                Retire
              </button>
              <button
                onClick={() => onDecide("keep")}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-transparent border border-gen-border-1 text-gen-text-3 hover:text-gen-text-0 hover:border-gen-border-3 transition-colors cursor-pointer"
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onDecide("accept", editedNewText || undefined)}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-gen-bg-4 border border-gen-border-3 text-gen-text-0 hover:bg-gen-bg-3 transition-colors cursor-pointer"
              >
                Accept
              </button>
              <button
                onClick={() => onDecide("skip")}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-transparent border border-gen-border-1 text-gen-text-3 hover:text-gen-text-0 hover:border-gen-border-3 transition-colors cursor-pointer"
              >
                Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

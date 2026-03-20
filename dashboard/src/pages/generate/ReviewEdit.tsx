import { useState, useRef, useEffect } from "react";
import { api, type GenDraft, type GenCoachCheckQuality, type GenStory } from "../../api/client";
import ExpertiseCard from "./components/ExpertiseCard";
import AlignmentCard from "./components/AlignmentCard";
import PostDetailsCard from "./components/PostDetailsCard";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ReviewEditProps {
  gen: {
    generationId: number | null;
    finalDraft: string;
    qualityGate: GenCoachCheckQuality | null;
    drafts: GenDraft[];
    selectedDraftIndices: number[];
    stories: GenStory[];
    selectedStoryIndex: number | null;
    chatMessages: ChatMessage[];
  };
  setGen: (fn: (prev: any) => any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onBack: () => void;
  onReset: () => void;
}

export default function ReviewEdit({ gen, setGen, loading, setLoading, onBack, onReset }: ReviewEditProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalDraft(gen.finalDraft); }, [gen.finalDraft]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [localDraft]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gen.chatMessages]);

  const sendMessage = async (message: string) => {
    if (!gen.generationId || !message.trim()) return;
    setLoading(true);
    setChatError(null);

    // Add user message optimistically
    setGen((prev: any) => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user", content: message.trim() }],
    }));

    try {
      const draftChanged = localDraft !== gen.finalDraft ? localDraft : undefined;
      const res = await api.generateChat(gen.generationId, message.trim(), draftChanged);
      setGen((prev: any) => ({
        ...prev,
        finalDraft: res.draft,
        qualityGate: res.quality,
        chatMessages: [...prev.chatMessages, { role: "assistant", content: res.explanation }],
      }));
      setChatInput("");
    } catch (err: any) {
      console.error("Chat failed:", err);
      setChatError(err.message ?? "Revision failed. Try again.");
      // Remove optimistic user message on error
      setGen((prev: any) => ({
        ...prev,
        chatMessages: prev.chatMessages.slice(0, -1),
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleOpenLinkedIn = async () => {
    await navigator.clipboard.writeText(localDraft);
    window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank");
  };

  const wordCount = localDraft.split(/\s+/).filter(Boolean).length;
  const selectedDraftTypes = gen.selectedDraftIndices.map((i) => gen.drafts[i]?.type).filter(Boolean);
  const storyHeadline = gen.selectedStoryIndex !== null ? gen.stories[gen.selectedStoryIndex]?.headline || "" : "";
  const structureLabel = gen.drafts[gen.selectedDraftIndices[0]]?.structure_label || "";

  const shortcutChips = [
    { label: "Shorten", prompt: "Make this post shorter and punchier. Cut anything that doesn't earn its place. Target 20-30% shorter." },
    { label: "Strengthen close", prompt: "Rewrite just the closing. Make it a sharper question that invites informed disagreement or practitioner reflection." },
    { label: "Regenerate", prompt: "Regenerate this draft from scratch with a different angle and structure, keeping the same core topic and research." },
  ];

  const expertiseItems = gen.qualityGate?.expertise_needed ?? [];
  const alignmentItems = gen.qualityGate?.alignment ?? [];

  return (
    <div>
      <div className="flex gap-6">
        {/* Editor panel */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={localDraft}
            onChange={(e) => setLocalDraft(e.target.value)}
            className="w-full bg-transparent text-[15.5px] leading-[1.85] text-gen-text-1 resize-none focus:outline-none min-h-[300px]"
            style={{ fontFamily: "var(--font-sans)" }}
          />
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gen-border-1">
            <span className="text-[12px] text-gen-text-3">{wordCount} words</span>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[340px] flex-shrink-0 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {/* Expertise cards */}
          <ExpertiseCard
            items={expertiseItems}
            onClickItem={(question) => setChatInput(question)}
          />

          {/* Chat thread */}
          {gen.chatMessages.length > 0 && (
            <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
              <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Conversation</h4>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {gen.chatMessages.map((msg, i) => (
                  <div key={i} className={`text-[12px] leading-snug ${msg.role === "user" ? "text-gen-text-1" : "text-gen-text-2 pl-3 border-l-2 border-gen-accent/30"}`}>
                    {msg.content}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          {/* Chat error */}
          {chatError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-400">
              {chatError}
            </div>
          )}

          {/* Chat input */}
          <div className="space-y-2">
            {/* Shortcut chips */}
            <div className="flex gap-1.5">
              {shortcutChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => sendMessage(chip.prompt)}
                  disabled={loading}
                  className="px-3 py-1.5 bg-gen-bg-3 border border-gen-border-2 text-gen-text-2 text-[11px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim()) sendMessage(chatInput);
                }}
                placeholder="Tell the AI what to change..."
                className="flex-1 bg-gen-bg-2 border border-gen-border-2 rounded-lg px-3 py-2 text-[12px] text-gen-text-1 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent-border"
              />
              <button
                onClick={() => { if (chatInput.trim()) sendMessage(chatInput); }}
                disabled={!chatInput.trim() || loading}
                className="px-3 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[12px] rounded-lg hover:border-gen-border-3 transition-colors disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>

          {/* Alignment */}
          <AlignmentCard items={alignmentItems} />

          {/* Post details */}
          <PostDetailsCard
            storyHeadline={storyHeadline}
            draftsUsed={selectedDraftTypes}
            structureLabel={structureLabel}
            wordCount={wordCount}
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-[13px] text-gen-text-2 hover:text-gen-text-0 transition-colors">
            Back to drafts
          </button>
          <button onClick={onReset} className="text-[13px] text-gen-text-3 hover:text-gen-text-1 transition-colors">
            Start new
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleCopy} className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors">
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button onClick={handleOpenLinkedIn} className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors">
            Open in LinkedIn
          </button>
        </div>
      </div>
    </div>
  );
}

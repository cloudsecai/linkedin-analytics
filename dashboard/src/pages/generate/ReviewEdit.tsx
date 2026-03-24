import { useState, useRef, useEffect } from "react";
import { api, type GenDraft, type GenCoachCheckQuality, type GenStory } from "../../api/client";
import AlignmentCard from "./components/AlignmentCard";
import PostDetailsCard from "./components/PostDetailsCard";
import ScannerLoader from "./components/ScannerLoader";

const REVISION_MESSAGES = [
  "Revising the draft...",
  "Applying your feedback...",
  "Reworking the structure...",
  "Tightening the argument...",
  "Removing filler...",
  "Sharpening the hook...",
  "Checking voice consistency...",
  "Polishing transitions...",
  "Running quality checks...",
  "Almost there...",
];

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
  onRetro?: () => void;
}

export default function ReviewEdit({ gen, setGen, loading, setLoading, onBack, onRetro }: ReviewEditProps) {
  const [localDraft, setLocalDraft] = useState(gen.finalDraft);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
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

  const regeneratePrompt = "Regenerate this draft from scratch with a different angle and structure, keeping the same core topic and research.";

  const expertiseItems = gen.qualityGate?.expertise_needed ?? [];
  const alignmentItems = gen.qualityGate?.alignment ?? [];

  const hasConversation = gen.chatMessages.length > 0;
  const placeholderText = "e.g. Make it shorter, add a stronger hook, change the tone...";

  // Build initial expertise prompts as conversation starters (shown before any user messages)
  const expertisePrompts = !hasConversation && expertiseItems.length > 0
    ? expertiseItems.map((item) => ({
        area: item.area,
        question: item.question,
      }))
    : [];

  if (loading) {
    return <ScannerLoader messages={REVISION_MESSAGES} interval={2000} />;
  }

  return (
    <div>
      <div className="flex gap-6">
        {/* Editor panel */}
        <div className="flex-1 min-w-0">
          <div
            className={`rounded-xl border transition-colors p-5 ${
              isFocused
                ? "border-gen-accent/40 bg-gen-bg-1/50"
                : "border-gen-border-1 bg-gen-bg-1/30 hover:border-gen-border-2"
            }`}
          >
            <textarea
              ref={textareaRef}
              value={localDraft}
              onChange={(e) => setLocalDraft(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className="w-full bg-transparent text-[15.5px] leading-[1.85] text-gen-text-1 resize-none focus:outline-none min-h-[300px]"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </div>

          {/* Action buttons + word count */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-gen-text-3">{wordCount} words</span>
              <button onClick={onBack} className="text-[12px] text-gen-text-3 hover:text-gen-text-1 transition-colors">
                Back to drafts
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleCopy} className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-1 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 transition-colors">
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
              <button onClick={handleOpenLinkedIn} className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[13px] font-medium rounded-[10px] hover:bg-white transition-colors">
                Open in LinkedIn
              </button>
              {onRetro && (
                <button onClick={onRetro} className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-2 text-[13px] font-medium rounded-[10px] hover:border-gen-accent/40 hover:text-gen-accent transition-colors">
                  Post Retro
                </button>
              )}
              <button
                onClick={() => sendMessage(regeneratePrompt)}
                disabled={loading}
                className="px-4 py-2 bg-gen-bg-3 border border-gen-border-2 text-gen-text-2 text-[13px] font-medium rounded-[10px] hover:border-gen-border-3 hover:text-gen-text-1 transition-colors disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
          </div>

          {/* Feedback area */}
          <div className="mt-4 space-y-3">
            {/* Expertise prompts — things the AI wants to know */}
            {expertisePrompts.length > 0 && (
              <div className="space-y-2">
                {expertisePrompts.map((item, i) => (
                  <div key={i} className="pl-3 border-l-2 border-gen-accent/30">
                    <p className="text-[11px] font-medium text-gen-accent mb-0.5">{item.area}</p>
                    <p className="text-[12.5px] text-gen-text-2 leading-snug">{item.question}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Chat input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim()) {
                    e.preventDefault();
                    sendMessage(chatInput);
                  }
                }}
                placeholder={placeholderText}
                className="flex-1 bg-gen-bg-2 border border-gen-border-2 rounded-lg px-3 py-2 text-[13px] text-gen-text-1 placeholder:text-gen-text-3 focus:outline-none focus:border-gen-accent-border"
              />
              <button
                onClick={() => { if (chatInput.trim()) sendMessage(chatInput); }}
                disabled={!chatInput.trim() || loading}
                className="px-4 py-2 bg-gen-accent text-white text-[12px] font-medium rounded-lg transition-colors disabled:opacity-40 disabled:bg-gen-bg-3 disabled:text-gen-text-3"
              >
                {loading ? "..." : "Send"}
              </button>
            </div>

            {/* Chat history */}
            {gen.chatMessages.length > 0 && (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {gen.chatMessages.map((msg, i) => (
                  <div key={i} className={`text-[12.5px] leading-snug ${msg.role === "user" ? "text-gen-text-1" : "text-gen-text-2 pl-3 border-l-2 border-gen-accent/30"}`}>
                    {msg.content}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Chat error */}
            {chatError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-400">
                {chatError}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — alignment + post details */}
        <div className="w-[300px] flex-shrink-0 flex flex-col gap-4">
          <AlignmentCard items={alignmentItems} />
          <PostDetailsCard
            storyHeadline={storyHeadline}
            draftsUsed={selectedDraftTypes}
            structureLabel={structureLabel}
            wordCount={wordCount}
          />
        </div>
      </div>
    </div>
  );
}

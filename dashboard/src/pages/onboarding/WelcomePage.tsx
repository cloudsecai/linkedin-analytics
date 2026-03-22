interface WelcomePageProps {
  onStart: () => void;
}

export default function WelcomePage({ onStart }: WelcomePageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <h1 className="text-[28px] font-semibold text-text-primary mb-2">
        <span className="text-accent">Reach</span>Lab
      </h1>
      <p className="text-[14px] text-text-muted mb-8 max-w-md">
        Write LinkedIn posts that sound like you, powered by AI that knows your voice.
      </p>

      <div className="flex gap-3 mb-8">
        {[
          { num: 1, label: "Connect\nLinkedIn" },
          { num: 2, label: "Voice\nInterview" },
          { num: 3, label: "Find\nSources" },
        ].map(({ num, label }) => (
          <div
            key={num}
            className="text-center px-6 py-4 bg-surface-2 border border-border rounded-xl"
          >
            <div className="text-[22px] text-accent font-light">{num}</div>
            <div className="text-[11px] text-text-muted mt-1 whitespace-pre-line">{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 transition-opacity"
      >
        Get started
      </button>
      <p className="text-[11px] text-text-muted mt-3">
        ~10 minutes &middot; makes everything work better
      </p>
    </div>
  );
}

import { useState } from "react";
import WelcomePage from "./WelcomePage";
import ExtensionSetup from "./ExtensionSetup";
import AnalyzeWriting from "./AnalyzeWriting";
import VoiceInterview from "./VoiceInterview";
import SourceDiscovery from "./SourceDiscovery";
import SetupComplete from "./SetupComplete";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "extension" | "analyze" | "interview" | "sources" | "done";

const STEP_PROGRESS: Record<Step, number> = {
  welcome: 0,
  extension: 20,
  analyze: 40,
  interview: 60,
  sources: 80,
  done: 100,
};

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>("welcome");

  return (
    <div className="min-h-screen bg-surface-0">
      {/* Progress bar */}
      {step !== "welcome" && step !== "done" && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-surface-2 z-50">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${STEP_PROGRESS[step]}%` }}
          />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-12">
        {step === "welcome" && (
          <WelcomePage onStart={() => setStep("extension")} />
        )}
        {step === "extension" && (
          <ExtensionSetup
            onNext={() => setStep("analyze")}
            onSkip={() => setStep("analyze")}
          />
        )}
        {step === "analyze" && (
          <AnalyzeWriting
            onNext={() => setStep("interview")}
            onSkip={() => setStep("interview")}
          />
        )}
        {step === "interview" && (
          <VoiceInterview
            onNext={() => setStep("sources")}
            onSkip={() => setStep("sources")}
          />
        )}
        {step === "sources" && (
          <SourceDiscovery
            onNext={() => setStep("done")}
            onSkip={() => setStep("done")}
          />
        )}
        {step === "done" && (
          <SetupComplete onFinish={onComplete} />
        )}
      </div>
    </div>
  );
}

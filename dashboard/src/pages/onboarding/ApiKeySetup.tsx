import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface ApiKeySetupProps {
  onComplete: () => void;
}

interface KeyConfig {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  prefix: string;
  url: string;
}

export default function ApiKeySetup({ onComplete }: ApiKeySetupProps) {
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfigKeys()
      .then(({ keys: k }) => {
        setKeys(k);
        // Pre-fill with empty strings
        const v: Record<string, string> = {};
        for (const key of k) v[key.key] = "";
        setValues(v);
      })
      .catch(() => setError("Failed to load configuration"))
      .finally(() => setLoading(false));
  }, []);

  const requiredKeys = keys.filter((k) => k.required);
  const optionalKeys = keys.filter((k) => !k.required);
  const allRequiredConfigured = requiredKeys.every(
    (k) => k.configured || values[k.key]?.trim()
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send keys that have values
      const toSave: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) toSave[key] = value.trim();
      }
      if (Object.keys(toSave).length > 0) {
        await api.saveConfigKeys(toSave);
      }
      onComplete();
    } catch (err: any) {
      setError(err.message ?? "Failed to save keys");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-semibold tracking-tight mb-2">
            <span className="text-accent">Reach</span>Lab
          </h1>
          <p className="text-[14px] text-text-secondary">
            Before we get started, ReachLab needs an API key to power its AI features.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
            {error}
          </div>
        )}

        {/* Required keys */}
        <div className="space-y-4 mb-6">
          {requiredKeys.map((k) => (
            <KeyInput
              key={k.key}
              config={k}
              value={values[k.key] ?? ""}
              onChange={(v) => setValues((prev) => ({ ...prev, [k.key]: v }))}
            />
          ))}
        </div>

        {/* Optional keys */}
        {optionalKeys.length > 0 && (
          <div className="mb-6">
            <p className="text-[12px] text-text-muted mb-3">
              Optional — you can add these later in Settings
            </p>
            <div className="space-y-4">
              {optionalKeys.map((k) => (
                <KeyInput
                  key={k.key}
                  config={k}
                  value={values[k.key] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [k.key]: v }))}
                />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!allRequiredConfigured || saving}
          className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

function KeyInput({
  config,
  value,
  onChange,
}: {
  config: KeyConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[13px] font-medium text-text-primary">
          {config.label}
          {config.required && !config.configured && (
            <span className="text-negative ml-1 text-[11px]">required</span>
          )}
        </label>
        {config.configured && (
          <span className="text-[11px] text-green-400 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.3 5.3l-4 4a.75.75 0 01-1.1 0l-2-2a.75.75 0 111.1-1.1L6.8 8.7l3.4-3.4a.75.75 0 111.1 1.1z" />
            </svg>
            configured
          </span>
        )}
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config.configured ? "Already configured (paste to replace)" : `Paste your key (${config.prefix}...)`}
        className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent font-mono"
      />
      <a
        href={config.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-accent hover:underline mt-1.5 inline-block"
      >
        Get a key →
      </a>
    </div>
  );
}

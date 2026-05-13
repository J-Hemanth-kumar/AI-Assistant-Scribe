import React from 'react';
import { useAppContext } from '@/context/AppContext';

export function SettingsPanel() {
  const { state, dispatch } = useAppContext();
  const { settings } = state;

  const update = (patch: Partial<typeof settings>) =>
    dispatch({ type: 'SET_SETTINGS', payload: patch });

  return (
    <div className="flex flex-col gap-5 px-3 py-3">
      <Section title="Appearance">
        <SelectField
          label="Theme"
          value={settings.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          onChange={(v) => update({ theme: v as typeof settings.theme })}
        />
        <ToggleField
          label="Compact mode"
          description="Reduce padding in message bubbles"
          checked={settings.compactMode}
          onChange={(v) => update({ compactMode: v })}
        />
      </Section>

      <Section title="Chat">
        <ToggleField
          label="Streaming responses"
          description="Show tokens as they are generated"
          checked={settings.streamingEnabled}
          onChange={(v) => update({ streamingEnabled: v })}
        />
        <ToggleField
          label="Show citations"
          description="Display inline citation badges"
          checked={settings.citationsVisible}
          onChange={(v) => update({ citationsVisible: v })}
        />
      </Section>

      <Section title="Connection">
        <TextField
          label="WebSocket URL"
          value={settings.wsUrl}
          placeholder="ws://localhost:18000/ws/chat"
          onChange={(v) => update({ wsUrl: v })}
        />
        <TextField
          label="API Base URL"
          value={settings.apiBaseUrl}
          placeholder="http://localhost:18000"
          onChange={(v) => update({ apiBaseUrl: v })}
        />
      </Section>

      <div className="mt-2 rounded-xl bg-surface-50 border border-surface-200 p-3">
        <p className="text-[11px] font-semibold text-surface-600 mb-1">About Scribe</p>
        <p className="text-[10px] text-surface-400 leading-relaxed">
          Scribe is a multimodal AI assistant frontend powered by your RAG pipeline.
          Configure the WebSocket and API URLs to point to your backend.
        </p>
      </div>
    </div>
  );
}

// ── Field primitives ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-surface-500 uppercase tracking-wide mb-2 px-1">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-surface-50 transition-colors">
      <div>
        <p className="text-xs font-medium text-surface-700">{label}</p>
        <p className="text-[10px] text-surface-400">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none
                    focus-visible:ring-2 focus-visible:ring-accent-500 shrink-0
                    ${checked ? 'bg-accent-500' : 'bg-surface-200'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                      transition-transform duration-200
                      ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="px-1 py-1">
      <label className="text-[10px] font-semibold text-surface-500 uppercase tracking-wide block mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input-base text-xs font-mono"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="px-1 py-1">
      <label className="text-[10px] font-semibold text-surface-500 uppercase tracking-wide block mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base text-xs appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

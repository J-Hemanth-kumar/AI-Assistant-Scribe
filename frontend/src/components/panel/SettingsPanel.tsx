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
            { value: 'light', label: '☀️ Light' },
            { value: 'dark', label: '🌙 Dark' },
            { value: 'system', label: '💻 System' },
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

      <div className="mt-2 rounded-2xl bg-gradient-to-br from-accent-50 to-purple-50 dark:from-accent-900/10 dark:to-purple-900/10
                      border border-accent-200/30 dark:border-accent-700/20 p-4">
        <p className="text-[11px] font-bold text-accent-700 dark:text-accent-400 mb-1">About Scribe</p>
        <p className="text-[10px] text-surface-500 dark:text-slate-400 leading-relaxed">
          Scribe is a multimodal AI assistant frontend powered by your RAG pipeline.
          Configure the WebSocket and API URLs to point to your backend.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">
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
    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl
                    hover:bg-surface-50 dark:hover:bg-slate-800/30 transition-colors duration-200">
      <div>
        <p className="text-xs font-medium text-surface-700 dark:text-slate-300">{label}</p>
        <p className="text-[10px] text-surface-400 dark:text-slate-500">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5.5 rounded-full transition-all duration-300 focus:outline-none
                    focus-visible:ring-2 focus-visible:ring-accent-500/40 shrink-0
                    ${checked
                      ? 'bg-gradient-to-r from-accent-500 to-accent-400 shadow-glow-accent'
                      : 'bg-surface-200 dark:bg-slate-700'}`}
        style={{ width: 40, height: 22 }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-sm
                      transition-transform duration-300 ease-out
                      ${checked ? 'translate-x-[18px]' : 'translate-x-0'}`}
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
      <label className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest block mb-1">
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
      <label className="text-[10px] font-bold text-surface-400 dark:text-slate-500 uppercase tracking-widest block mb-1">
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

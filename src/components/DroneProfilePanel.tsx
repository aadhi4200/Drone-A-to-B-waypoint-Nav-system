import React, { useState, useEffect } from 'react';
import { Settings2, Cpu, Zap } from 'lucide-react';
import { DroneProfile, RangeEstimate } from '../types';
import { getProfile, setProfile as apiSetProfile, setMode as apiSetMode } from '../api';

const FIELDS: { key: keyof DroneProfile; label: string; step?: number }[] = [
  { key: 'motor_kv', label: 'Motor KV' },
  { key: 'esc_amp', label: 'ESC continuous (A)' },
  { key: 'battery_mah', label: 'Battery capacity (mAh)' },
  { key: 'cells', label: 'Battery cells (S)' },
  { key: 'num_motors', label: '# Motors' },
  { key: 'auw_grams', label: 'All-up weight (g)' },
  { key: 'efficiency_factor', label: 'Efficiency factor (A/kg, ~22 default)' },
  { key: 'cruise_speed_ms', label: 'Cruise speed (m/s)' },
];

interface DroneProfilePanelProps {
  mode: 'sim' | 'hardware';
  onModeChange: (mode: 'sim' | 'hardware') => void;
}

export default function DroneProfilePanel({ mode, onModeChange }: DroneProfilePanelProps) {
  const [profile, setProfileState] = useState<DroneProfile>({});
  const [estimate, setEstimate] = useState<RangeEstimate | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile().then(({ profile, estimate }) => { setProfileState(profile); setEstimate(estimate); }).catch(() => {});
  }, []);

  const handleField = (key: keyof DroneProfile, value: string) => {
    setProfileState(prev => ({ ...prev, [key]: value === '' ? null : parseFloat(value) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { estimate } = await apiSetProfile(profile);
      setEstimate(estimate);
    } finally {
      setSaving(false);
    }
  };

  const toggleMode = async () => {
    const next = mode === 'sim' ? 'hardware' : 'sim';
    onModeChange(next);
    try { await apiSetMode(next); } catch { onModeChange(mode); }
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Settings2 className="w-4 h-4 text-cyan-400" />
          <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">Drone Profile & Mode</h3>
        </div>
        <button
          onClick={toggleMode}
          className={`px-3 py-1 rounded-lg text-[10px] font-mono font-bold uppercase cursor-pointer border flex items-center gap-1.5 ${
            mode === 'sim'
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" /> {mode === 'sim' ? 'SIM MODE' : 'HARDWARE MODE'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(f => (
          <label key={f.key} className="text-[9px] font-mono text-slate-400 space-y-0.5">
            {f.label}
            <input
              type="number"
              value={profile[f.key] ?? ''}
              onChange={e => handleField(f.key, e.target.value)}
              className="w-full bg-slate-950/40 border border-white/10 rounded px-2 py-1 text-white text-[11px]"
            />
          </label>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 rounded-xl text-xs font-bold uppercase bg-cyan-500 text-slate-950 hover:bg-cyan-400 cursor-pointer disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save profile & recompute estimate'}
      </button>

      {estimate && (
        <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10 text-[10.5px] font-mono space-y-1">
          {estimate.flight_time_min !== null ? (
            <>
              <div className="flex justify-between"><span className="text-slate-400">Est. flight time</span><span className="text-cyan-300 font-bold">{estimate.flight_time_min} min</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Est. max range</span><span className="text-cyan-300 font-bold">{estimate.range_m} m</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Hover current</span><span className="text-slate-300">{estimate.hover_current_a} A</span></div>
            </>
          ) : (
            <div className="text-amber-400">{estimate.note}</div>
          )}
          <div className="flex items-start gap-1.5 text-amber-400/90 pt-1 border-t border-white/5 mt-1">
            <Zap className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{estimate.note}</span>
          </div>
        </div>
      )}
    </div>
  );
}

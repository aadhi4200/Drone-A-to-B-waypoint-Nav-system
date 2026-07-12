import React from 'react';
import { MapPin, Sparkles, Trash2, Gauge } from 'lucide-react';
import { MissionWaypoint } from '../types';

interface WaypointListProps {
  waypoints: MissionWaypoint[];
  onUpdateAlt: (label: string, alt: number) => void;
  onRemove: (label: string) => void;
  onGenerateMarker: (label: string) => void;
  speedMs: number;
  onSetSpeedMs: (v: number) => void;
  mode: 'sim' | 'hardware';
  abortAltitudeM: number;
  disabled: boolean;
}

export default function WaypointList({
  waypoints, onUpdateAlt, onRemove, onGenerateMarker,
  speedMs, onSetSpeedMs, mode, abortAltitudeM, disabled,
}: WaypointListProps) {
  return (
    <div className="bg-[#141417] backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MapPin className="w-4 h-4 text-[#ffd02c]" />
          <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">
            Mission Stops
          </h3>
        </div>
        <span className="text-[9px] text-[#7c7c84] font-mono uppercase">{waypoints.length} stop(s)</span>
      </div>

      {waypoints.length === 0 ? (
        <div className="text-[10px] text-[#7c7c84] font-mono py-2 text-center">
          Click "Dest Coords" mode, then click the map to add a delivery stop.
        </div>
      ) : (
        <div className="space-y-2">
          {waypoints.map(wp => (
            <div key={wp.label} className="bg-[#0a0a0c]/90 p-2.5 rounded-xl border border-white/10 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] font-mono">
                <span className="text-[#ffd02c] font-bold">
                  {wp.label} <span className="text-[#7c7c84] font-normal">({wp.lat.toFixed(5)}, {wp.lng.toFixed(5)})</span>
                </span>
                <button
                  onClick={() => onRemove(wp.label)}
                  className="text-[#7c7c84] hover:text-red-400 cursor-pointer"
                  title="Remove stop"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[9.5px] font-mono text-[#9a9aa2]">
                  ALT (m)
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    max={abortAltitudeM}
                    value={wp.alt}
                    onChange={e => onUpdateAlt(wp.label, parseFloat(e.target.value) || 0)}
                    className="w-16 bg-[#141417]/60 border border-white/10 rounded px-1.5 py-0.5 text-white text-[10.5px]"
                  />
                  <span className="text-[#7c7c84]">/ max {abortAltitudeM}m</span>
                </label>

                {mode === 'sim' ? (
                  <button
                    onClick={() => onGenerateMarker(wp.label)}
                    disabled={disabled || wp.markerStatus === 'generating'}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9.5px] font-bold uppercase cursor-pointer border ${
                      wp.markerStatus === 'spawned'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-[#ffd02c]/10 border-[#ffd02c]/30 text-[#ffd02c] hover:bg-[#ffd02c]/10 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {wp.markerStatus === 'generating' ? 'Spawning...'
                      : wp.markerStatus === 'spawned' ? `Marker #${wp.markerId} live`
                      : wp.markerStatus === 'error' ? 'Retry marker'
                      : 'Generate ArUco marker'}
                  </button>
                ) : (
                  <span className="text-[9px] text-amber-400/80 font-mono italic">
                    Marker generation is sim-only. Print marker ID {wp.markerId ?? '?'} and place it at this waypoint before flight.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-white/5">
        <label className="flex items-center justify-between text-[9.5px] font-mono text-[#9a9aa2] uppercase mb-1">
          <span className="flex items-center gap-1"><Gauge className="w-3 h-3 text-[#ffd02c]" /> Mission max speed</span>
          <span className="text-[#ffd02c] font-bold">{speedMs.toFixed(1)} m/s</span>
        </label>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={speedMs}
          onChange={e => onSetSpeedMs(parseFloat(e.target.value))}
          className="w-full accent-[#ffd02c]"
        />
      </div>
    </div>
  );
}

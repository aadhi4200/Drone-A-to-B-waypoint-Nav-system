import React from 'react';
import { MapPin, Sparkles, Trash2, Gauge, RotateCcw } from 'lucide-react';
import { MissionWaypoint } from '../types';

interface WaypointListProps {
  waypoints: MissionWaypoint[];
  onUpdateAlt: (label: string, alt: number) => void;
  onRemove: (label: string) => void;
  onClearAll: () => void;
  // Locks the Reset button only while a mission is flying — unlike `disabled`
  // (all-clear gate), clearing the local plan is safe whenever idle.
  missionActive?: boolean;
  onGenerateMarker: (label: string) => void;
  speedMs: number;
  onSetSpeedMs: (v: number) => void;
  landMode: 'aruco' | 'gps';
  onSetLandMode: (v: 'aruco' | 'gps') => void;
  waitS: number;
  onSetWaitS: (v: number) => void;
  mode: 'sim' | 'hardware';
  abortAltitudeM: number;
  disabled: boolean;
}

export default function WaypointList({
  waypoints, onUpdateAlt, onRemove, onClearAll, missionActive = false, onGenerateMarker,
  speedMs, onSetSpeedMs, landMode, onSetLandMode, waitS, onSetWaitS,
  mode, abortAltitudeM, disabled,
}: WaypointListProps) {
  return (
    <div className="bg-[#141417] backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MapPin className="w-4 h-4 text-[#5996FF]" />
          <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">
            Mission Stops
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#7c7c84] font-mono uppercase">{waypoints.length} stop(s)</span>
          {waypoints.length > 0 && (
            <button
              onClick={onClearAll}
              disabled={missionActive}
              className="flex items-center gap-1 text-[9px] font-bold font-mono uppercase text-red-400/90 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title={missionActive ? 'Locked while a mission is flying' : 'Remove all stops and start planning over'}
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
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
                <span className="text-[#5996FF] font-bold">
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
                        : 'bg-[#5996FF]/10 border-[#5996FF]/30 text-[#5996FF] hover:bg-[#5996FF]/10 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {wp.markerStatus === 'generating' ? 'Spawning...'
                      : wp.markerStatus === 'spawned' ? `Marker #${wp.markerId} live`
                      : wp.markerStatus === 'error' ? 'Retry marker'
                      : 'Generate ArUco marker'}
                  </button>
                ) : (
                  <span className="text-[9px] text-blue-400/80 font-mono italic">
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
          <span className="flex items-center gap-1"><Gauge className="w-3 h-3 text-[#5996FF]" /> Mission max speed</span>
          <span className="text-[#5996FF] font-bold">{speedMs.toFixed(1)} m/s</span>
        </label>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={speedMs}
          onChange={e => onSetSpeedMs(parseFloat(e.target.value))}
          className="w-full accent-[#5996FF]"
        />
      </div>

      <div className="pt-2 border-t border-white/5 space-y-1.5">
        <label className="block text-[9.5px] font-mono text-[#9a9aa2] uppercase">
          Landing at each stop
        </label>
        <div className="flex gap-1.5">
          <button
            onClick={() => onSetLandMode('aruco')}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[9.5px] font-bold uppercase cursor-pointer border ${
              landMode === 'aruco'
                ? 'bg-[#5996FF]/15 border-[#5996FF]/40 text-[#5996FF]'
                : 'bg-[#0a0a0c]/60 border-white/10 text-[#7c7c84] hover:text-white'
            }`}
          >
            ArUco auto-land
          </button>
          <button
            onClick={() => onSetLandMode('gps')}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[9.5px] font-bold uppercase cursor-pointer border ${
              landMode === 'gps'
                ? 'bg-[#5996FF]/15 border-[#5996FF]/40 text-[#5996FF]'
                : 'bg-[#0a0a0c]/60 border-white/10 text-[#7c7c84] hover:text-white'
            }`}
          >
            GPS land (no marker)
          </button>
        </div>
        {landMode === 'gps' && (
          <div className="text-[9px] text-[#7c7c84] font-mono italic">
            Lands on the GPS waypoint without searching for a marker.
          </div>
        )}
        <label className="flex items-center justify-between text-[9.5px] font-mono text-[#9a9aa2] uppercase pt-1">
          <span>Ground wait before next takeoff</span>
          <span className="text-[#5996FF] font-bold">{waitS.toFixed(0)} s</span>
        </label>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={waitS}
          onChange={e => onSetWaitS(parseFloat(e.target.value))}
          className="w-full accent-[#5996FF]"
        />
      </div>
    </div>
  );
}

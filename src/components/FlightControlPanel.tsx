import React from 'react';
import { Play, RotateCcw, ShieldAlert, Zap, Radio, PlaneTakeoff, AlertTriangle, MapPin, Crosshair, Timer } from 'lucide-react';
import { LatLng, BatteryState, SignalState, FlightState } from '../types';

interface FlightControlPanelProps {
  startLoc: LatLng;
  destLoc: LatLng | null;
  dronePos: LatLng;
  flightState: FlightState;
  battery: BatteryState;
  signal: SignalState;
  onSetStartLoc: (loc: LatLng) => void;
  onSetDestLoc: (loc: LatLng | null) => void;
  onPlanPath: () => void;
  onLaunchMission: () => void;
  onEmergencyOverride: () => void;
  onResetDrone: () => void;
  activePathLength: number;
  gpsSyncStatus: 'idle' | 'locating' | 'success' | 'error';
  gpsSyncError: string | null;
  onSyncLaptopLocation: () => void;
  missionTimeSec: number;
  ros2Connected?: boolean;           // ← NEW: shows ROS2 LIVE / SIM MODE badge
}

export default function FlightControlPanel({
  startLoc,
  destLoc,
  dronePos,
  flightState,
  battery,
  signal,
  onSetStartLoc,
  onSetDestLoc,
  onPlanPath,
  onLaunchMission,
  onEmergencyOverride,
  onResetDrone,
  activePathLength,
  gpsSyncStatus,
  gpsSyncError,
  onSyncLaptopLocation,
  missionTimeSec,
  ros2Connected,                     // ← NEW
}: FlightControlPanelProps) {

  const canPlan   = startLoc && destLoc;
  const canLaunch = startLoc && destLoc &&
    (flightState === FlightState.IDLE || flightState === FlightState.PLANNING);

  const getSignalStatus = (dbm: number) => {
    if (dbm > -60) return { label: "Excellent Link Connect",  color: "text-emerald-400" };
    if (dbm > -75) return { label: "Standard Signal Stable",  color: "text-amber-400" };
    return          { label: "Poor Noise Alert",              color: "text-red-400 animate-pulse" };
  };
  const signalStatus = getSignalStatus(signal.strengthDbm);

  return (
    <div id="uav-flight-controls" className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between h-[520px] relative overflow-y-auto pr-1">
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="border-b border-white/10 pb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h3 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Mission Control</h3>
          </div>

          {/* Flight state + ROS2 connection badge */}
          <div className="flex items-center gap-1.5">
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded border ${
              flightState === FlightState.EN_ROUTE
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : flightState === FlightState.EMERGENCY_LANDING
                ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                : flightState === FlightState.LANDED_SAFE
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                : 'bg-white/5 text-slate-300 border-white/10'
            }`}>
              {flightState}
            </span>

            {/* ── ROS2 LIVE / SIM MODE badge ── */}
            {ros2Connected !== undefined && (
              <span className={`px-2 py-0.5 text-[9px] font-mono rounded border ${
                ros2Connected
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>
                {ros2Connected ? '● ROS2 LIVE' : '○ SIM MODE'}
              </span>
            )}
          </div>
        </div>

        {/* ── Mission Stopwatch ── */}
        <div className="bg-slate-950/50 rounded-xl p-3 border border-white/10 flex items-center justify-between font-mono">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${flightState === FlightState.EN_ROUTE ? 'bg-cyan-500/10 text-cyan-400 animate-pulse' : 'bg-slate-900/60 text-slate-500'}`}>
              <Timer className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block leading-none mb-1">MISSION TIME</span>
              <span className="text-[8.5px] uppercase block font-bold leading-none">
                {flightState === FlightState.EN_ROUTE ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    RECORDING
                  </span>
                ) : flightState === FlightState.EMERGENCY_LANDING ? (
                  <span className="flex items-center gap-1 text-rose-400 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    EMER DEVIATION
                  </span>
                ) : flightState === FlightState.LANDED_SAFE ? (
                  <span className="text-amber-400">COMPLETED</span>
                ) : (
                  <span className="text-slate-500">STANDBY</span>
                )}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-xl font-bold font-mono tracking-widest leading-none ${
              flightState === FlightState.EN_ROUTE        ? 'text-cyan-400'  :
              flightState === FlightState.EMERGENCY_LANDING ? 'text-rose-400' :
              flightState === FlightState.LANDED_SAFE     ? 'text-amber-400' : 'text-slate-400'
            }`}>
              {(() => {
                const mins = Math.floor(missionTimeSec / 60);
                const secs = missionTimeSec % 60;
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              })()}
            </div>
            <div className="text-[8px] text-slate-500 font-bold uppercase mt-1 leading-none">
              {flightState === FlightState.EN_ROUTE || flightState === FlightState.EMERGENCY_LANDING
                ? 'ACTIVE TELEMETRY' : 'LOCKED'}
            </div>
          </div>
        </div>

        {/* ── Coordinates / GPS Sync ── */}
        <div className="space-y-3.5">
          <div className="text-[10px] font-mono text-slate-400 tracking-wider uppercase">Active Trajectory Coordinates</div>

          {/* GPS Sync */}
          <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10 font-mono">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9.5px] text-slate-400 font-bold uppercase flex items-center gap-1">
                <MapPin className="w-3 h-3 text-cyan-400 animate-pulse" />
                LAPTOP GPS LOCK
              </span>
              {gpsSyncStatus === 'locating' ? (
                <span className="text-[9px] text-cyan-400 font-bold animate-pulse">🛰️ LOCKING ON...</span>
              ) : gpsSyncStatus === 'success' ? (
                <span className="text-[9px] text-emerald-400 font-bold flex items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1 animate-ping" />
                  ● SUCCESS
                </span>
              ) : gpsSyncStatus === 'error' ? (
                <span className="text-[9px] text-rose-400 font-bold">⚠️ BLOCKED</span>
              ) : (
                <span className="text-[9px] text-slate-500">● STANDBY</span>
              )}
            </div>

            <button
              id="btn-sync-laptop-gps"
              type="button"
              onClick={onSyncLaptopLocation}
              disabled={gpsSyncStatus === 'locating'}
              className="w-full py-1.5 px-3 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 uppercase"
            >
              <Crosshair className={`w-3.5 h-3.5 ${gpsSyncStatus === 'locating' ? 'animate-spin' : ''}`} />
              {gpsSyncStatus === 'locating' ? 'ACQUIRING GPS LOCK...' : 'Sync Laptop GPS to Drone A'}
            </button>

            {gpsSyncError && (
              <div className="mt-2 text-[9px] text-rose-400 font-mono leading-tight">{gpsSyncError}</div>
            )}
          </div>

          {/* Coordinates display */}
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10">
              <div className="text-[9px] text-slate-400 uppercase mb-1">Start (A)</div>
              <div className="text-[10px] text-amber-300 font-bold">{startLoc.lat.toFixed(6)}</div>
              <div className="text-[10px] text-amber-300 font-bold">{startLoc.lng.toFixed(6)}</div>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10">
              <div className="text-[9px] text-slate-400 uppercase mb-1">Dest (B)</div>
              {destLoc ? (
                <>
                  <div className="text-[10px] text-emerald-300 font-bold">{destLoc.lat.toFixed(6)}</div>
                  <div className="text-[10px] text-emerald-300 font-bold">{destLoc.lng.toFixed(6)}</div>
                </>
              ) : (
                <div className="text-[10px] text-slate-500 italic">Click map to set</div>
              )}
            </div>
          </div>

          {/* Distance */}
          <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10 flex items-center justify-between font-mono">
            <div>
              <div className="text-[9.5px] font-bold text-cyan-400 uppercase">Delivery Zone Distance</div>
              <div className="text-[10px] text-slate-400 mt-0.5 uppercase">
                {flightState === FlightState.EN_ROUTE ? 'Live Tracking' : 'Planned'}
              </div>
            </div>
            <div className="text-right">
              {destLoc ? (
                <>
                  <div className="text-sm font-bold text-white">
                    {(() => {
                      const dLat = dronePos.lat - destLoc.lat;
                      const dLng = (dronePos.lng - destLoc.lng) * Math.cos((dronePos.lat * Math.PI) / 180);
                      return `${(Math.sqrt(dLat*dLat + dLng*dLng) * 111).toFixed(3)} km`;
                    })()}
                  </div>
                  <div className="text-[9px] text-slate-500">
                    {(() => {
                      const dLat = dronePos.lat - destLoc.lat;
                      const dLng = (dronePos.lng - destLoc.lng) * Math.cos((dronePos.lat * Math.PI) / 180);
                      return `${Math.round(Math.sqrt(dLat*dLat + dLng*dLng) * 111000)} m`;
                    })()}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500 italic">No target</div>
              )}
            </div>
          </div>

          <button
            id="btn-calculate-flightpath"
            disabled={!canPlan}
            onClick={onPlanPath}
            className={`w-full py-2.5 border rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
              canPlan
                ? 'bg-cyan-500 border-transparent text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/20'
                : 'bg-white/5 border-white/5 text-slate-500 cursor-not-allowed'
            }`}
          >
            <PlaneTakeoff className="w-4 h-4" />
            <span>Plan Optimized Flight Trajectory</span>
          </button>
        </div>

        {/* ── Hardware Metrology ── */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <div className="text-[10px] font-mono text-slate-400 tracking-wider uppercase">Active Hardware Metrology</div>
          <div className="bg-slate-950/40 p-3.5 rounded-xl border border-white/10 space-y-3.5">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-300 flex items-center font-semibold">
                  <Zap className="w-3.5 h-3.5 text-amber-400 mr-1.5" /> Core Lithium Pack
                </span>
                <span className={`font-semibold ${battery.percentage < 25 ? 'text-red-400 animate-pulse' : 'text-slate-200'}`}>
                  {battery.percentage.toFixed(0)}% ({battery.voltage.toFixed(1)}V)
                </span>
              </div>
              <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                <div
                  className={`h-full transition-all duration-300 ${battery.percentage < 25 ? 'bg-red-500' : 'bg-cyan-500'}`}
                  style={{ width: `${battery.percentage}%` }}
                />
              </div>
              <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                {battery.cellVoltages.map((v, i) => (
                  <span key={i}>Cell {i+1}: {v.toFixed(2)}V</span>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-300 flex items-center font-semibold">
                  <Radio className="w-3.5 h-3.5 text-cyan-400 mr-1.5" /> Telemetry Link
                </span>
                <span className="text-cyan-400 font-bold">{signal.strengthDbm} dBm</span>
              </div>
              <div className="text-[10.5px] font-mono text-slate-400">{signalStatus.label}</div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Flight Execution Controls ── */}
      <div className="mt-6 space-y-3.5">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            id="btn-launch-delivery"
            disabled={!canLaunch}
            onClick={onLaunchMission}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 border transition-all cursor-pointer ${
              canLaunch
                ? 'bg-cyan-500 border-transparent text-slate-950 hover:bg-cyan-400 shadow-md shadow-cyan-500/20'
                : 'bg-white/5 border-white/5 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Launch Mission</span>
          </button>
          <button
            id="btn-reset-telemetry"
            onClick={onResetDrone}
            className="py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reset System</span>
          </button>
        </div>

        <button
          id="btn-emergency-override"
          disabled={flightState !== FlightState.EN_ROUTE}
          onClick={onEmergencyOverride}
          className={`w-full py-3 rounded-xl border font-bold text-xs uppercase flex items-center justify-center space-x-2.5 transition-all cursor-pointer ${
            flightState === FlightState.EN_ROUTE
              ? 'bg-red-600 border-transparent text-white hover:bg-red-500 shadow-lg shadow-red-900/40 animate-pulse'
              : 'bg-white/5 border-white/5 text-slate-600 cursor-not-allowed'
          }`}
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>EMERGENCY LANDING OVERRIDE</span>
        </button>

        {flightState === FlightState.EMERGENCY_LANDING && (
          <div className="p-3 bg-red-950/20 border border-red-600/30 rounded-xl text-red-400 text-[10px] font-mono flex items-start space-x-2 animate-pulse uppercase leading-relaxed font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div>OVERRIDE ACTIVE. Lowering barometric altitude. Dispatching emergency telemetry.</div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, RotateCcw, ShieldAlert, Zap, Radio, PlaneTakeoff, HelpCircle, Compass, Anchor, AlertTriangle, BatteryCharging, Power, MapPin, Crosshair, Timer, Home, ChevronsRight, X } from 'lucide-react';
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
  onReturnHome: () => void;
  onResetDrone: () => void;
  activePathLength: number;
  gpsSyncStatus: 'idle' | 'locating' | 'success' | 'error';
  gpsSyncError: string | null;
  homeLastSyncedAt?: string | null;
  onSyncLaptopLocation: () => void;
  missionTimeSec: number;
  ros2Connected?: boolean;
  droneStatus?: string;
  onArmDrone: () => void;
  allClear?: boolean;
  waypointCount?: number;
  mode?: 'sim' | 'hardware';
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
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
  onReturnHome,
  onResetDrone,
  activePathLength,
  gpsSyncStatus,
  gpsSyncError,
  homeLastSyncedAt,
  onSyncLaptopLocation,
  missionTimeSec,
  ros2Connected,
  droneStatus,
  onArmDrone,
  allClear = true,
  waypointCount = 0,
  mode = 'sim',
}: FlightControlPanelProps) {

  // Simple input validation
  const canPlan = startLoc && destLoc;
  const canLaunch = startLoc && (destLoc || waypointCount > 0) && allClear
    && (flightState === FlightState.IDLE || flightState === FlightState.PLANNING);

  // Slide-to-launch confirmation modal: the Launch button opens it, and the
  // mission only starts once the slider is dragged all the way across —
  // a deliberate two-step action so a stray click can't launch the drone.
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [slidePct, setSlidePct] = useState(0);

  const closeLaunchModal = () => {
    setShowLaunchModal(false);
    setSlidePct(0);
  };

  const handleSlideRelease = () => {
    if (slidePct >= 95) {
      closeLaunchModal();
      onLaunchMission();
    } else {
      setSlidePct(0); // not far enough — snap back
    }
  };
  const isArmed = droneStatus === 'ARMED' || droneStatus === 'AIRBORNE' || droneStatus === 'LANDING';

  // Signal status descriptor Helper
  const getSignalStatus = (dbm: number) => {
    if (dbm > -60) return { label: "Excellent Link Connect", color: "text-emerald-400" };
    if (dbm > -75) return { label: "Standard Signal Stable", color: "text-blue-400" };
    return { label: "Poor Noise Alert", color: "text-red-400 animate-pulse" };
  };

  const signalStatus = getSignalStatus(signal.strengthDbm);

  return (
    <div id="uav-flight-controls" className="bg-[#141417] backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between h-[520px] relative overflow-y-auto pr-1">
      <div className="space-y-5">
        
        {/* Header containing Battery & Signal meters */}
        <div className="border-b border-white/10 pb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-[#5996FF] animate-pulse" />
            <h3 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Mission Control</h3>
          </div>
          <div>
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded border ${
              flightState === FlightState.EN_ROUTE ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
              flightState === FlightState.EMERGENCY_LANDING ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' :
              flightState === FlightState.LANDED_SAFE ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              'bg-[#141417] text-[#d1d1d6] border-white/10 backdrop-blur-md'
            }`}>
              {flightState}
            </span>
          </div>
        </div>

        {/* Mission Flight Stopwatch Widget */}
        <div className="bg-[#1c1c20] rounded-xl p-3 border border-white/10 flex items-center justify-between font-mono">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${flightState === FlightState.EN_ROUTE ? 'bg-[#5996FF]/10 text-[#5996FF] animate-pulse' : 'bg-[#141417]/60 text-[#7c7c84]'}`}>
              <Timer className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[9px] text-[#9a9aa2] font-bold uppercase tracking-wider block leading-none mb-1">MISSION TIME</span>
              <span className="text-[8.5px] uppercase block font-bold leading-none">
                {flightState === FlightState.EN_ROUTE ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                    RECORDING
                  </span>
                ) : flightState === FlightState.EMERGENCY_LANDING ? (
                  <span className="flex items-center gap-1 text-rose-400 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                    EMER DEVIATION
                  </span>
                ) : flightState === FlightState.LANDED_SAFE ? (
                  <span className="text-blue-400">COMPLETED</span>
                ) : (
                  <span className="text-[#7c7c84]">STANDBY</span>
                )}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-xl font-bold font-mono tracking-widest leading-none ${
              flightState === FlightState.EN_ROUTE ? 'text-[#5996FF]' :
              flightState === FlightState.EMERGENCY_LANDING ? 'text-rose-400' :
              flightState === FlightState.LANDED_SAFE ? 'text-blue-400' : 'text-[#9a9aa2]'
            }`}>
              {(() => {
                const mins = Math.floor(missionTimeSec / 60);
                const secs = missionTimeSec % 60;
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              })()}
            </div>
            <div className="text-[8px] text-[#7c7c84] font-bold uppercase mt-1 leading-none">
              {flightState === FlightState.EN_ROUTE || flightState === FlightState.EMERGENCY_LANDING ? 'ACTIVE TELEMETRY' : 'LOCKED'}
            </div>
          </div>
        </div>

        {/* Start / Delivery Destination Coordinates entry form */}
        <div className="space-y-3.5">
          <div className="text-[10px] font-mono text-[#9a9aa2] tracking-wider uppercase">Active Trajectory Coordinates</div>
          
          {/* Laptop Geolocation Sync Hub -- sim-only: real hardware gets true
              home from its own GPS module at boot, this laptop-sync workaround
              only exists to tell PX4 SITL where Gazebo's home is. */}
          {mode === 'hardware' ? (
            <div className="bg-[#0a0a0c]/90 p-3 rounded-xl border border-white/10 font-mono">
              <div className="text-[9.5px] text-[#9a9aa2] font-bold uppercase flex items-center gap-1 mb-1.5">
                <MapPin className="w-3 h-3 text-[#7c7c84]" />
                LAPTOP GPS LOCK
              </div>
              <p className="text-[9px] text-[#7c7c84] leading-snug uppercase">
                Sim-only. Real hardware gets home from its own GPS module at boot -- no sync needed.
              </p>
            </div>
          ) : (
          <div className="bg-[#0a0a0c]/90 p-3 rounded-xl border border-white/10 font-mono">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9.5px] text-[#9a9aa2] font-bold uppercase flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#5996FF] animate-pulse" />
                LAPTOP GPS LOCK
              </span>
              {gpsSyncStatus === 'locating' ? (
                <span className="text-[9px] text-[#5996FF] font-bold animate-pulse flex items-center">
                  🛰️ LOCKING ON...
                </span>
              ) : gpsSyncStatus === 'success' ? (
                <span className="text-[9px] text-emerald-400 font-bold flex items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1 animate-ping"></span>
                  ● SUCCESS
                </span>
              ) : gpsSyncStatus === 'error' ? (
                <span className="text-[9px] text-rose-400 font-bold">⚠️ BLOCKED</span>
              ) : (
                <span className="text-[9px] text-[#7c7c84]">● STANDBY</span>
              )}
            </div>

            <button
              id="btn-sync-laptop-gps"
              type="button"
              onClick={onSyncLaptopLocation}
              disabled={gpsSyncStatus === 'locating'}
              className="w-full py-1.5 px-3 bg-[#5996FF]/10 hover:bg-[#5996FF]/10 active:bg-[#5996FF]/30 border border-[#5996FF]/30 text-[#5996FF] hover:text-white rounded-lg text-[10px] font-bold tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
              <Crosshair className={`w-3.5 h-3.5 ${gpsSyncStatus === 'locating' ? 'animate-spin text-[#5996FF]' : 'text-[#5996FF]'}`} />
              {gpsSyncStatus === 'locating' ? 'Locking Satellite...' : 'Use Laptop Location'}
            </button>

            <div className="text-[8.5px] text-[#9a9aa2] leading-normal pt-1.5 mt-1.5 border-t border-white/5 uppercase">
              💡 <span className="font-semibold text-blue-400/90">Workaround:</span> Toggle <strong className="text-blue-400">"Start Coords"</strong> above the map, then use the search bar to locate your city!
            </div>

            {gpsSyncError && (
              <p className="text-[9px] text-rose-300 font-semibold leading-snug pt-1 px-1 text-center bg-rose-500/10 rounded-lg border border-rose-500/20 mt-1.5 uppercase">
                {gpsSyncError}
              </p>
            )}

            {homeLastSyncedAt && (
              <p className="text-[9px] text-[#7c7c84] font-mono leading-snug pt-1 px-1 text-center uppercase">
                Home last synced: {formatAge(homeLastSyncedAt)}
              </p>
            )}
          </div>
          )}

          <div className="grid grid-cols-2 gap-3.5">
            {/* Start Lat/Lng input */}
            <div className="space-y-1 bg-[#0a0a0c]/90 p-2.5 rounded-xl border border-white/10 backdrop-blur-sm focus-within:border-[#5996FF]/40 transition-all">
              <label className="text-[9.5px] font-mono font-bold text-blue-400 uppercase flex items-center">
                <Anchor className="w-3 h-3 mr-1" /> Base Station (S)
              </label>
              <div className="space-y-1 text-xs font-mono">
                <div>
                  <span className="text-[#7c7c84] text-[9px] mr-1">LAT:</span>
                  <input
                    id="input-start-lat"
                    type="number"
                    step="0.0001"
                    value={startLoc.lat}
                    onChange={(e) => onSetStartLoc({ ...startLoc, lat: parseFloat(e.target.value) || 9.9658 })}
                    className="bg-transparent border-none text-white focus:outline-none w-20 text-[11px]"
                  />
                </div>
                <div>
                  <span className="text-[#7c7c84] text-[9px] mr-1">LNG:</span>
                  <input
                    id="input-start-lng"
                    type="number"
                    step="0.0001"
                    value={startLoc.lng}
                    onChange={(e) => onSetStartLoc({ ...startLoc, lng: parseFloat(e.target.value) || 76.2421 })}
                    className="bg-transparent border-none text-white focus:outline-none w-24 text-[11px]"
                  />
                </div>
              </div>
            </div>

            {/* Destination Lat/Lng input */}
            <div className="space-y-1 bg-[#0a0a0c]/90 p-2.5 rounded-xl border border-white/10 backdrop-blur-sm focus-within:border-[#5996FF]/40 transition-all">
              <label className="text-[9.5px] font-mono font-bold text-[#5996FF] uppercase flex items-center">
                <Compass className="w-3 h-3 mr-1" /> Delivery Zone (D)
              </label>
              <div className="space-y-1 text-xs font-mono">
                {destLoc ? (
                  <>
                    <div>
                      <span className="text-[#7c7c84] text-[9px] mr-1">LAT:</span>
                      <input
                        id="input-dest-lat"
                        type="number"
                        step="0.0001"
                        value={destLoc.lat}
                        onChange={(e) => onSetDestLoc({ ...destLoc, lat: parseFloat(e.target.value) || 0 })}
                        className="bg-transparent border-none text-white focus:outline-none w-20 text-[11px]"
                      />
                    </div>
                    <div>
                      <span className="text-[#7c7c84] text-[9px] mr-1">LNG:</span>
                      <input
                        id="input-dest-lng"
                        type="number"
                        step="0.0001"
                        value={destLoc.lng}
                        onChange={(e) => onSetDestLoc({ ...destLoc, lng: parseFloat(e.target.value) || 0 })}
                        className="bg-transparent border-none text-white focus:outline-none w-24 text-[11px]"
                      />
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-[#7c7c84] leading-normal py-1 font-semibold font-sans">
                    Click coordinates on Map Pane to register
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Live Remaining Distance Card */}
          <div className="bg-[#0a0a0c]/90 p-3 rounded-xl border border-white/10 backdrop-blur-sm flex items-center justify-between font-mono">
            <div>
              <div className="text-[9.5px] font-bold text-[#5996FF] uppercase flex items-center">
                <span className={`relative flex h-2 w-2 mr-1.5 ${flightState === FlightState.EN_ROUTE ? 'block' : 'hidden'}`}>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#5996FF] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#5996FF]"></span>
                </span>
                Delivery Zone Distance
              </div>
              <div className="text-[10px] text-[#9a9aa2] mt-0.5 uppercase">
                {flightState === FlightState.EN_ROUTE ? 'Live Tracking Distance' : 'Planned Trajectory'}
              </div>
            </div>
            <div className="text-right">
              {destLoc ? (
                <>
                  <div className="text-sm font-bold text-white">
                    {(() => {
                      const dLat = dronePos.lat - destLoc.lat;
                      const dLng = (dronePos.lng - destLoc.lng) * Math.cos((dronePos.lat * Math.PI) / 180);
                      const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
                      return `${distKm.toFixed(3)} km`;
                    })()}
                  </div>
                  <div className="text-[9px] text-[#7c7c84]">
                    {(() => {
                      const dLat = dronePos.lat - destLoc.lat;
                      const dLng = (dronePos.lng - destLoc.lng) * Math.cos((dronePos.lat * Math.PI) / 180);
                      const distM = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
                      return `${Math.round(distM)} meters`;
                    })()}
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#7c7c84] italic">No Target set</div>
              )}
            </div>
          </div>
          
          <button
            id="btn-calculate-flightpath"
            disabled={!canPlan}
            onClick={onPlanPath}
            className={`w-full py-2.5 border rounded-xl text-xs font-bold font-sans flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
              canPlan 
                ? 'bg-[#5996FF] border-transparent text-black hover:bg-[#ffdd55] shadow-md shadow-black/40' 
                : 'bg-[#141417] border-white/5 text-[#7c7c84] cursor-not-allowed'
            }`}
          >
            <PlaneTakeoff className="w-4 h-4" />
            <span>Plan Optimized Flight Trajectory</span>
          </button>
        </div>

        {/* Drone Hardware Status (Battery Pack Cell Volts + Signal Decibel levels) */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <div className="text-[10px] font-mono text-[#9a9aa2] tracking-wider uppercase">Active Hardware Metrology</div>

          <div className="bg-[#0a0a0c]/90 p-3.5 rounded-xl border border-white/10 space-y-3.5 backdrop-blur-sm">
            {/* Battery Cell Voltages and Temperature */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-[#d1d1d6] flex items-center font-semibold"><Zap className="w-3.5 h-3.5 text-blue-400 mr-1.5" /> Core Lithium Pack</span>
                <span className={`font-semibold ${battery.percentage < 25 ? 'text-red-400 animate-pulse font-bold' : 'text-white'}`}>{battery.percentage.toFixed(0)}% ({battery.voltage.toFixed(1)}V)</span>
              </div>
              {/* Depletion graph meter */}
              <div className="h-2 bg-[#141417] rounded-full overflow-hidden border border-white/5">
                <div 
                  className={`h-full transition-all duration-300 ${battery.percentage < 25 ? 'bg-red-500' : 'bg-[#5996FF] shadow-[0_0_8px_rgba(89,150,255,0.5)]'}`}
                  style={{ width: `${battery.percentage}%` }}
                />
              </div>
              {/* Multi-Cell Status */}
              <div className="flex justify-between text-[8px] text-[#7c7c84] font-mono">
                <span>Cell 1: {battery.cellVoltages[0].toFixed(2)}V</span>
                <span>Cell 2: {battery.cellVoltages[1].toFixed(2)}V</span>
                <span>Cell 3: {battery.cellVoltages[2].toFixed(2)}V</span>
                <span>Cell 4: {battery.cellVoltages[3].toFixed(2)}V</span>
              </div>
            </div>

            {/* Signal Strength DBm Status */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-[#d1d1d6] flex items-center font-semibold text-[11px]"><Radio className="w-3.5 h-3.5 text-[#5996FF] mr-1.5" /> Telemetry Link</span>
                <span className={`text-[11.5px] font-bold ${signalStatus.color.includes('text-emerald-400') ? 'text-[#5996FF]' : signalStatus.color}`}>{signal.strengthDbm} dBm (RSSI)</span>
              </div>
              <div className="text-[10.5px] font-mono text-[#9a9aa2] leading-none">
                {signalStatus.label}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Flight Execution Controls & Urgent LANDING OVERRIDE button */}
      <div className="mt-6 space-y-3.5">

        {/* Arm Drone button */}
        <button
          id="btn-arm-drone"
          type="button"
          disabled={isArmed || !ros2Connected || !allClear}
          onClick={onArmDrone}
          title={!ros2Connected ? 'ROS2 backend not connected' : !allClear ? 'Blocked — see connectivity banner above' : undefined}
          className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold font-sans flex items-center justify-center space-x-1.5 border transition-all uppercase ${
            isArmed
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
              : ros2Connected
                ? 'bg-blue-500 border-transparent text-white hover:bg-blue-400 shadow-md shadow-blue-500/20 cursor-pointer'
                : 'bg-[#141417] border-white/5 text-[#7c7c84] cursor-not-allowed'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          <span>{isArmed ? `Drone Armed (${droneStatus})` : 'Arm Drone'}</span>
        </button>

        {/* Run System button */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            id="btn-launch-delivery"
            disabled={!canLaunch}
            onClick={() => setShowLaunchModal(true)}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold font-sans flex items-center justify-center space-x-1 border transition-all cursor-pointer ${
              canLaunch
                ? 'bg-[#5996FF] border-transparent text-black hover:bg-[#ffdd55] shadow-md shadow-black/40'
                : 'bg-[#141417] border-white/5 text-[#7c7c84] cursor-not-allowed'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Launch Mission</span>
          </button>

          <button
            id="btn-reset-telemetry"
            onClick={onResetDrone}
            className="py-2.5 px-3 rounded-xl text-xs font-bold font-sans flex items-center justify-center space-x-1 border border-white/10 bg-[#141417] text-[#d1d1d6] hover:bg-white/10 hover:text-white transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#5996FF]" />
            <span>Reset System</span>
          </button>
        </div>

        {/* Return Home — flies back to the recorded home position first,
            then lands; distinct from Emergency Override's land-in-place */}
        <button
          id="btn-return-home"
          disabled={flightState !== FlightState.EN_ROUTE}
          onClick={onReturnHome}
          title={flightState !== FlightState.EN_ROUTE ? 'Only available while en route' : 'Fly back to home and land'}
          className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold font-sans flex items-center justify-center space-x-1.5 border transition-all uppercase ${
            flightState === FlightState.EN_ROUTE
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 cursor-pointer'
              : 'bg-[#141417] border-white/5 text-[#7c7c84] cursor-not-allowed'
          }`}
        >
          <Home className="w-3.5 h-3.5" />
          <span>Return Home</span>
        </button>

        {/* EMERGENCY OVERRIDE TRIGGER */}
        <button
          id="btn-emergency-override"
          disabled={flightState !== FlightState.EN_ROUTE}
          onClick={onEmergencyOverride}
          className={`w-full py-3 rounded-xl border font-bold font-sans text-xs uppercase flex items-center justify-center space-x-2.5 transition-all cursor-pointer ${
            flightState === FlightState.EN_ROUTE
              ? 'bg-red-600 border-transparent text-white hover:bg-red-500 shadow-lg shadow-red-900/40 animate-pulse'
              : 'bg-[#141417] border-white/5 text-[#7c7c84] cursor-not-allowed'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-white shrink-0" />
          <span>EMERGENCY LANDING OVERRIDE</span>
        </button>

        {flightState === FlightState.EMERGENCY_LANDING && (
          <div className="p-3 bg-red-950/20 border border-red-600/30 rounded-xl text-red-400 text-[10px] font-mono flex items-start space-x-2 animate-pulse uppercase leading-relaxed font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div>
              EMERGENCY OVERRIDE ENGAGED. Initiating controlled descent & publishing ABORT command to the ROS2 mission bridge.
            </div>
          </div>
        )}
      </div>

      {/* Slide-to-launch confirmation modal — rendered via portal onto
          document.body: the panel root's backdrop-filter makes it a CSS
          containing block, which would otherwise trap (and its overflow
          clip) this fixed-position overlay. */}
      {showLaunchModal && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeLaunchModal}
        >
          <div
            className="bg-[#141417] border border-white/10 rounded-2xl p-5 w-[340px] space-y-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <PlaneTakeoff className="w-4 h-4 text-[#5996FF]" />
                <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">Confirm Mission Launch</h3>
              </div>
              <button onClick={closeLaunchModal} className="text-[#7c7c84] hover:text-white cursor-pointer" title="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#0a0a0c]/90 rounded-xl border border-white/10 p-3 space-y-1.5 text-[10.5px] font-mono">
              <div className="flex justify-between">
                <span className="text-[#7c7c84] uppercase">Mission stops</span>
                <span className="text-white font-bold">{waypointCount > 0 ? `${waypointCount} waypoint(s)` : 'direct A → B'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7c7c84] uppercase">Drone status</span>
                <span className="text-white font-bold">{droneStatus || 'UNKNOWN'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7c7c84] uppercase">Systems</span>
                <span className={allClear ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {allClear ? 'ALL CLEAR' : 'NOT READY'}
                </span>
              </div>
            </div>

            <p className="text-[9.5px] text-[#7c7c84] font-mono leading-relaxed">
              Once launched, waypoint planning is locked until the mission completes. Slide all the way to start the mission.
            </p>

            {/* Slide to launch */}
            <div className="relative h-12 rounded-xl bg-[#0a0a0c] border border-white/10 overflow-hidden select-none">
              <div
                className="absolute inset-y-0 left-0 bg-[#5996FF]/25 border-r border-[#5996FF]/40"
                style={{ width: `${slidePct}%`, transition: slidePct === 0 ? 'width 200ms ease' : 'none' }}
              />
              <div className="absolute inset-0 flex items-center justify-center space-x-1.5 text-[10px] font-mono uppercase tracking-widest text-[#9a9aa2] pointer-events-none">
                <span>{slidePct >= 95 ? 'Release to launch' : 'Slide to launch'}</span>
                <ChevronsRight className="w-3.5 h-3.5 animate-pulse" />
              </div>
              <div
                className="absolute inset-y-1 flex items-center justify-center w-10 rounded-lg bg-[#5996FF] text-black shadow-md pointer-events-none"
                style={{ left: `calc(${slidePct}% * 0.86)`, transition: slidePct === 0 ? 'left 200ms ease' : 'none' }}
              >
                <ChevronsRight className="w-4 h-4" />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={slidePct}
                onChange={e => setSlidePct(Number(e.target.value))}
                onMouseUp={handleSlideRelease}
                onTouchEnd={handleSlideRelease}
                onKeyUp={e => { if (e.key === 'Enter' && slidePct >= 95) handleSlideRelease(); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Slide to launch mission"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}

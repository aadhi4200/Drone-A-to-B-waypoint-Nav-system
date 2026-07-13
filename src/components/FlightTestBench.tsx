import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plane, Gauge, Compass, Activity, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  RotateCw, RotateCcw, Power, PlaneTakeoff, PlaneLanding, OctagonPause,
  AlertTriangle, Wifi, WifiOff, Battery,
} from 'lucide-react';
import { ImuMessage, PositionMessage, NodeStatusMessage } from '../types';
import { ManualNudgeCmd } from '../api';

interface FlightTestBenchProps {
  imu: ImuMessage | null;
  position: PositionMessage | null;
  nodeStatus: NodeStatusMessage | null;
  wsConnected: boolean;
  droneStatus: string;
  onArm: () => void;
  onDisarm: () => void;
  onTakeoff: () => void;
  onLand: () => void;
  onManualNudge: (cmd: ManualNudgeCmd) => void;
}

// Fixed-size ring buffers keep memory flat over a long bench session.
const STAB_WINDOW = 120;   // samples used for the stability score
const TRACE_WINDOW = 160;  // samples drawn in the rate trace

interface RateSample { rx: number; ry: number; rz: number; }

// Classify the current motion into a human-readable maneuver label, purely
// from live attitude + rates, so the operator sees "PITCH FWD / ROLL LEFT /
// YAW CW / CLIMB" as they physically move the airframe on the bench.
function describeManeuver(
  pitch: number, roll: number,
  rate: { x: number; y: number; z: number },
  climbRate: number
): string[] {
  const labels: string[] = [];
  const R = (v: number) => (v * 180) / Math.PI; // rad/s -> deg/s for thresholds
  if (R(rate.y) > 12) labels.push('PITCH ↑ (nose up / back)');
  else if (R(rate.y) < -12) labels.push('PITCH ↓ (nose down / fwd)');
  if (R(rate.x) > 12) labels.push('ROLL → right');
  else if (R(rate.x) < -12) labels.push('ROLL ← left');
  if (R(rate.z) > 12) labels.push('YAW ↻ CW');
  else if (R(rate.z) < -12) labels.push('YAW ↺ CCW');
  if (climbRate > 0.3) labels.push('CLIMB');
  else if (climbRate < -0.3) labels.push('DESCEND');
  if (labels.length === 0) {
    const tilt = Math.hypot(pitch, roll);
    labels.push(tilt < 3 ? 'LEVEL / HOLD' : 'TILTED / HOLD');
  }
  return labels;
}

// ── Attitude indicator (artificial horizon) ──────────────────────────────
// The horizon rolls opposite the airframe roll and shifts vertically with
// pitch, exactly like a real ADI. Pure SVG, driven by live pitch/roll.
function AttitudeIndicator({ pitch, roll }: { pitch: number; roll: number }) {
  const pxPerDeg = 2.2;            // vertical shift per degree of pitch
  const shift = Math.max(-60, Math.min(60, pitch * pxPerDeg));
  return (
    <div className="relative">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-1.5 flex items-center gap-1.5">
        <Plane className="w-3.5 h-3.5 text-[#1ebcbd]" /> Attitude (ADI)
      </div>
      <svg viewBox="0 0 200 200" className="w-full rounded-full border border-[#1ebcbd]/25 bg-black shadow-[0_0_18px_rgba(30,188,189,0.15)]">
        <defs>
          <clipPath id="adi-clip"><circle cx="100" cy="100" r="92" /></clipPath>
        </defs>
        <g clipPath="url(#adi-clip)">
          {/* Rolling+pitching horizon ball */}
          <g transform={`rotate(${-roll} 100 100)`}>
            <g transform={`translate(0 ${shift})`}>
              <rect x="-120" y="-260" width="440" height="360" fill="#2a6db0" />
              <rect x="-120" y="100" width="440" height="360" fill="#6b4a2a" />
              <line x1="-120" y1="100" x2="320" y2="100" stroke="#ffffff" strokeWidth="2.5" />
              {/* Pitch ladder */}
              {[-30, -20, -10, 10, 20, 30].map((p) => (
                <g key={p}>
                  <line x1={100 - (p % 20 === 0 ? 34 : 20)} y1={100 - p * pxPerDeg}
                        x2={100 + (p % 20 === 0 ? 34 : 20)} y2={100 - p * pxPerDeg}
                        stroke="#ffffff" strokeWidth="1.4" opacity="0.85" />
                  {p % 20 === 0 && (
                    <text x={100 + 42} y={100 - p * pxPerDeg + 4} fill="#ffffff" fontSize="9"
                          fontFamily="monospace" textAnchor="middle">{Math.abs(p)}</text>
                  )}
                </g>
              ))}
            </g>
          </g>
          {/* Roll arc ticks (fixed to the case) */}
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => {
            const rad = ((a - 90) * Math.PI) / 180;
            const r1 = 92, r2 = a % 30 === 0 ? 80 : 85;
            return (
              <line key={a} x1={100 + r1 * Math.cos(rad)} y1={100 + r1 * Math.sin(rad)}
                    x2={100 + r2 * Math.cos(rad)} y2={100 + r2 * Math.sin(rad)}
                    stroke="#8fa3b8" strokeWidth="1.4" />
            );
          })}
        </g>
        {/* Roll pointer (fixed) */}
        <polygon points="100,8 94,20 106,20" fill="#ffd02c" />
        {/* Fixed aircraft reference */}
        <g stroke="#ffd02c" strokeWidth="3" fill="none">
          <line x1="60" y1="100" x2="86" y2="100" />
          <line x1="114" y1="100" x2="140" y2="100" />
          <circle cx="100" cy="100" r="3" fill="#ffd02c" />
        </g>
        <circle cx="100" cy="100" r="92" fill="none" stroke="#1ebcbd" strokeOpacity="0.4" strokeWidth="2" />
      </svg>
    </div>
  );
}

// ── Heading / yaw compass rose ───────────────────────────────────────────
function HeadingIndicator({ heading }: { heading: number }) {
  const h = ((heading % 360) + 360) % 360;
  return (
    <div className="relative">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-1.5 flex items-center gap-1.5">
        <Compass className="w-3.5 h-3.5 text-[#1ebcbd]" /> Heading (HSI)
      </div>
      <svg viewBox="0 0 200 200" className="w-full rounded-full border border-[#1ebcbd]/25 bg-[#0a1220] shadow-[0_0_18px_rgba(30,188,189,0.15)]">
        <g transform={`rotate(${-h} 100 100)`}>
          {Array.from({ length: 36 }).map((_, i) => {
            const a = i * 10;
            const rad = ((a - 90) * Math.PI) / 180;
            const major = a % 30 === 0;
            const r1 = 92, r2 = major ? 76 : 84;
            return (
              <g key={i}>
                <line x1={100 + r1 * Math.cos(rad)} y1={100 + r1 * Math.sin(rad)}
                      x2={100 + r2 * Math.cos(rad)} y2={100 + r2 * Math.sin(rad)}
                      stroke={major ? '#e2e8f0' : '#5b7a8c'} strokeWidth={major ? 1.8 : 1} />
                {major && (
                  <text x={100 + 64 * Math.cos(rad)} y={100 + 64 * Math.sin(rad) + 4}
                        fill="#cbd5e1" fontSize="11" fontFamily="monospace" textAnchor="middle"
                        transform={`rotate(${a} ${100 + 64 * Math.cos(rad)} ${100 + 64 * Math.sin(rad)})`}>
                    {a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : a / 10}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Fixed lubber line + aircraft */}
        <polygon points="100,8 94,22 106,22" fill="#ffd02c" />
        <g stroke="#1ebcbd" strokeWidth="2.5" fill="none">
          <line x1="100" y1="78" x2="100" y2="122" />
          <line x1="82" y1="104" x2="118" y2="104" />
          <line x1="90" y1="122" x2="110" y2="122" />
        </g>
        <text x="100" y="176" fill="#8ae8e9" fontSize="17" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
          {h.toFixed(0).padStart(3, '0')}°
        </text>
      </svg>
    </div>
  );
}

// ── Vertical tape (altitude or a generic value) ──────────────────────────
function VerticalTape({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  const ticks = Array.from({ length: 9 }).map((_, i) => i - 4);
  return (
    <div className="flex flex-col items-center">
      <div className="text-[9px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-1">{label}</div>
      <svg viewBox="0 0 60 180" className="h-40 rounded-lg border border-[#1ebcbd]/20 bg-[#0a1220]">
        <g transform="translate(0 90)">
          {ticks.map((t) => {
            const y = t * 20;
            const tickVal = value - t * 1; // 1 unit per major tick
            return (
              <g key={t}>
                <line x1="38" y1={y} x2="52" y2={y} stroke="#5b7a8c" strokeWidth="1" />
                <text x="34" y={y + 3} fill="#8fa3b8" fontSize="8" fontFamily="monospace" textAnchor="end">
                  {tickVal.toFixed(0)}
                </text>
              </g>
            );
          })}
        </g>
        <rect x="2" y="80" width="52" height="20" rx="2" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1" />
        <text x="28" y="94" fill={color} fontSize="12" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
          {value.toFixed(1)}
        </text>
      </svg>
      <div className="text-[9px] font-mono text-[#8fa3b8] mt-1">{unit}</div>
    </div>
  );
}

// ── 3D-ish drone model that tilts with real attitude ─────────────────────
// A CSS-3D quad: the body rotates by live pitch (X) / roll (Y) / yaw (Z),
// and the four rotors spin while armed. Watching this while you physically
// move the airframe confirms the IMU axes and signs are wired correctly.
function DroneModel({ pitch, roll, yaw, armed }: { pitch: number; roll: number; yaw: number; armed: boolean }) {
  const arm = 'absolute left-1/2 top-1/2 h-2 w-[86px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#1ebcbd]/40 via-[#1ebcbd] to-[#1ebcbd]/40';
  const rotor = (cls: string) => (
    <div className={`absolute h-9 w-9 rounded-full border-2 ${armed ? 'border-[#8ae8e9]' : 'border-[#3a4a5a]'} ${cls}`}>
      <div className={`absolute inset-0.5 rounded-full border-t-2 ${armed ? 'border-t-[#ffd02c] animate-spin' : 'border-t-[#5b7a8c]'}`}
           style={{ animationDuration: '0.18s' }} />
    </div>
  );
  return (
    <div className="relative h-56 w-full flex items-center justify-center" style={{ perspective: '620px' }}>
      {/* ground shadow */}
      <div className="absolute bottom-6 h-4 w-40 rounded-[50%] bg-black/50 blur-md" />
      <div
        className="relative h-32 w-32 transition-transform duration-75"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${60 - pitch}deg) rotateZ(${roll}deg) rotateY(${yaw * 0.4}deg)`,
        }}
      >
        <div className={arm} style={{ transform: 'translate(-50%,-50%) rotate(45deg)' }} />
        <div className={arm} style={{ transform: 'translate(-50%,-50%) rotate(-45deg)' }} />
        {/* central body */}
        <div className={`absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-lg ${armed ? 'bg-[#12333a] border-[#1ebcbd]' : 'bg-[#141820] border-[#3a4a5a]'} border-2 shadow-[0_0_16px_rgba(30,188,189,0.4)]`}>
          <div className={`absolute left-1/2 top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${armed ? 'bg-[#ffd02c]' : 'bg-[#5b7a8c]'}`} />
        </div>
        {rotor('left-[6px] top-[6px]')}
        {rotor('right-[6px] top-[6px]')}
        {rotor('left-[6px] bottom-[6px]')}
        {rotor('right-[6px] bottom-[6px]')}
      </div>
    </div>
  );
}

// ── Manual directional control pad ────────────────────────────────────
// Press-and-hold repeat while a button stays down (mouse or touch), same
// feel as a basic RC transmitter. Each repeat sends ONE small nudge --
// the backend/ROS side rate-limits nothing extra, this interval IS the
// rate limit, so it must stay slow enough that a stuck button can't run
// the drone away before the operator lets go.
const NUDGE_REPEAT_MS = 220;

function NudgeButton({
  label, icon, cmd, onNudge, disabled, className = '',
}: {
  label: string; icon: React.ReactNode; cmd: ManualNudgeCmd;
  onNudge: (cmd: ManualNudgeCmd) => void; disabled: boolean; className?: string;
}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);
  const start = useCallback(() => {
    if (disabled || intervalRef.current !== null) return;
    onNudge(cmd);
    intervalRef.current = setInterval(() => onNudge(cmd), NUDGE_REPEAT_MS);
  }, [disabled, cmd, onNudge]);
  useEffect(() => stop, [stop]); // cleanup on unmount

  return (
    <button
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={(e) => { e.preventDefault(); start(); }}
      onTouchEnd={stop}
      disabled={disabled}
      title={label}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border font-mono text-[9px] uppercase tracking-wide font-bold select-none transition-all active:scale-95 ${
        disabled
          ? 'border-white/5 bg-[#0a0a0c] text-[#4a4a52] cursor-not-allowed'
          : 'border-[#1ebcbd]/30 bg-[#0a1220] text-[#8ae8e9] hover:bg-[#1ebcbd]/15 active:bg-[#1ebcbd]/30 cursor-pointer'
      } ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ManualControlPad({
  armed, canFly, canControl, onManualNudge, onTakeoff, onLand,
}: {
  armed: boolean; canFly: boolean; canControl: boolean;
  onManualNudge: (cmd: ManualNudgeCmd) => void;
  onTakeoff: () => void; onLand: () => void;
}) {
  const nudgeDisabled = !canControl;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-[#1ebcbd]" /> Manual Control</span>
        {!canControl && (
          <span className="text-amber-400 normal-case tracking-normal flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {armed ? 'Take off to enable' : 'Arm to enable'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Takeoff / Land */}
        <div className="grid grid-rows-2 gap-2">
          <button onClick={onTakeoff} disabled={!armed || canFly}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[10px] uppercase font-bold py-2 transition-all">
            <PlaneTakeoff className="w-3.5 h-3.5" /> Takeoff
          </button>
          <button onClick={onLand} disabled={!canFly}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[10px] uppercase font-bold py-2 transition-all">
            <PlaneLanding className="w-3.5 h-3.5" /> Land
          </button>
        </div>

        {/* Yaw + vertical */}
        <div className="grid grid-cols-2 grid-rows-2 gap-2">
          <NudgeButton label="Yaw L" icon={<RotateCcw className="w-4 h-4" />} cmd="YAW_LEFT" onNudge={onManualNudge} disabled={nudgeDisabled} />
          <NudgeButton label="Yaw R" icon={<RotateCw className="w-4 h-4" />} cmd="YAW_RIGHT" onNudge={onManualNudge} disabled={nudgeDisabled} />
          <NudgeButton label="Up" icon={<ArrowUp className="w-4 h-4" />} cmd="UP" onNudge={onManualNudge} disabled={nudgeDisabled} />
          <NudgeButton label="Down" icon={<ArrowDown className="w-4 h-4" />} cmd="DOWN" onNudge={onManualNudge} disabled={nudgeDisabled} />
        </div>
      </div>

      {/* Directional D-pad: forward/back/left/right */}
      <div className="grid grid-cols-3 grid-rows-3 gap-2 mt-4 max-w-[220px] mx-auto">
        <div />
        <NudgeButton label="Fwd" icon={<ArrowUp className="w-5 h-5" />} cmd="FWD" onNudge={onManualNudge} disabled={nudgeDisabled} className="h-16" />
        <div />
        <NudgeButton label="Left" icon={<ArrowLeft className="w-5 h-5" />} cmd="LEFT" onNudge={onManualNudge} disabled={nudgeDisabled} className="h-16" />
        <NudgeButton
          label="Hold"
          icon={<OctagonPause className="w-5 h-5" />}
          cmd="HOLD"
          onNudge={onManualNudge}
          disabled={!canFly}
          className="h-16 !border-[#ef4444]/40 !text-[#ef4444] !bg-[#ef4444]/10"
        />
        <NudgeButton label="Right" icon={<ArrowRight className="w-5 h-5" />} cmd="RIGHT" onNudge={onManualNudge} disabled={nudgeDisabled} className="h-16" />
        <div />
        <NudgeButton label="Back" icon={<ArrowDown className="w-5 h-5" />} cmd="BACK" onNudge={onManualNudge} disabled={nudgeDisabled} className="h-16" />
        <div />
      </div>
      <p className="text-[9px] font-mono text-[#5b7a8c] text-center mt-3">
        Press and hold a direction to nudge the airframe. Hold = stop drifting and re-anchor here.
      </p>
    </div>
  );
}

export default function FlightTestBench({
  imu, position, nodeStatus, wsConnected, droneStatus, onArm, onDisarm,
  onTakeoff, onLand, onManualNudge,
}: FlightTestBenchProps) {
  const pitch = imu?.pitch ?? 0;
  const roll = imu?.roll ?? 0;
  const yaw = imu?.yaw ?? 0;
  const rate = imu?.rate ?? { x: 0, y: 0, z: 0 };
  const heading = position?.heading ?? 0;
  const altitude = position?.altitude ?? 0;

  const armed = droneStatus === 'ARMED' || droneStatus === 'AIRBORNE' || droneStatus === 'LANDING';
  const preflight = nodeStatus?.preflight;

  // Climb rate from successive altitude samples.
  const lastAltRef = useRef<{ a: number; t: number } | null>(null);
  const [climbRate, setClimbRate] = useState(0);
  useEffect(() => {
    if (!position) return;
    const now = performance.now() / 1000;
    const prev = lastAltRef.current;
    if (prev && now > prev.t) {
      const cr = (position.altitude - prev.a) / (now - prev.t);
      setClimbRate((c) => c * 0.7 + cr * 0.3); // light smoothing
    }
    lastAltRef.current = { a: position.altitude, t: now };
  }, [position]);

  // Rate ring buffers for the trace + stability score.
  const [rates, setRates] = useState<RateSample[]>([]);
  useEffect(() => {
    if (!imu) return;
    setRates((prev) => {
      const next = [...prev, { rx: imu.rate.x, ry: imu.rate.y, rz: imu.rate.z }];
      return next.length > TRACE_WINDOW ? next.slice(next.length - TRACE_WINDOW) : next;
    });
  }, [imu]);

  // Stability score: 100 minus a penalty from recent body-rate RMS (rad/s)
  // and current tilt. This is the "stability measure" — a single number an
  // operator can watch during a bench shake test.
  const stability = useMemo(() => {
    const win = rates.slice(-STAB_WINDOW);
    if (win.length < 4) return { score: 100, rms: 0 };
    const rms = Math.sqrt(
      win.reduce((s, r) => s + r.rx * r.rx + r.ry * r.ry + r.rz * r.rz, 0) / (win.length * 3)
    );
    const tilt = Math.hypot(pitch, roll);
    const penalty = Math.min(100, rms * 55 + tilt * 0.7);
    return { score: Math.max(0, Math.round(100 - penalty)), rms };
  }, [rates, pitch, roll]);

  const stabColor = stability.score >= 80 ? '#34d399' : stability.score >= 55 ? '#ffd02c' : '#ef4444';
  const maneuvers = describeManeuver(pitch, roll, rate, climbRate);
  const noData = !imu && !position;

  // Rate trace polylines (deg/s), fixed window.
  const traceW = 300, traceH = 90, rateRange = 120; // +/- deg/s full scale
  const toTrace = (key: 'rx' | 'ry' | 'rz') =>
    rates.map((r, i) => {
      const x = (i / Math.max(1, TRACE_WINDOW - 1)) * traceW;
      const deg = (r[key] * 180) / Math.PI;
      const y = traceH / 2 - Math.max(-rateRange, Math.min(rateRange, deg)) / rateRange * (traceH / 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="space-y-6">
      {/* Status / arm bar */}
      <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 ${armed ? 'bg-[#ef4444]/15 border-[#ef4444] text-[#ef4444]' : 'bg-[#12333a] border-[#1ebcbd] text-[#1ebcbd]'}`}>
            <Power className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold uppercase tracking-wide">
              {armed ? <span className="text-[#ef4444]">● ARMED</span> : <span className="text-[#8ae8e9]">○ DISARMED</span>}
            </div>
            <div className="text-[10px] font-mono text-[#8fa3b8]">Motor status: {droneStatus || 'UNKNOWN'}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className={`px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${wsConnected ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-[#8fa3b8] bg-[#141417]'}`}>
            {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {wsConnected ? 'TELEMETRY LIVE' : 'NO TELEMETRY'}
          </span>
          {preflight && (
            <span className="px-2.5 py-1 rounded-full border border-white/10 bg-[#141417] text-[#8fa3b8] flex items-center gap-1.5">
              <Battery className="w-3 h-3" /> {preflight.battery_pct?.toFixed(0)}%
            </span>
          )}
          {preflight && (
            <span className={`px-2.5 py-1 rounded-full border ${preflight.gps_lock ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'} bg-[#141417]`}>
              GPS {preflight.gps_lock ? `${preflight.satellites ?? '?'} sats` : 'NO FIX'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onArm} disabled={armed}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide border border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            Arm
          </button>
          <button onClick={onDisarm} disabled={!armed}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide border border-[#1ebcbd]/40 bg-[#1ebcbd]/10 text-[#8ae8e9] hover:bg-[#1ebcbd]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            Disarm
          </button>
        </div>
      </div>

      <ManualControlPad
        armed={armed}
        canFly={droneStatus === 'AIRBORNE' || droneStatus === 'LANDING'}
        canControl={(droneStatus === 'AIRBORNE' || droneStatus === 'LANDING') && wsConnected}
        onManualNudge={onManualNudge}
        onTakeoff={onTakeoff}
        onLand={onLand}
      />

      {noData && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-mono text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> No live IMU/telemetry yet — start the stack and this cluster animates from real /mavros/imu/data.
        </div>
      )}

      {/* Instrument cluster */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
          <AttitudeIndicator pitch={pitch} roll={roll} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
          <HeadingIndicator heading={heading} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4 flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-1.5 flex items-center gap-1.5">
            <Plane className="w-3.5 h-3.5 text-[#1ebcbd]" /> Airframe Attitude (live)
          </div>
          <DroneModel pitch={pitch} roll={roll} yaw={yaw} armed={armed} />
        </div>
      </div>

      {/* Numeric attitude + tapes + stability */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attitude / rate digits */}
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-3 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-[#1ebcbd]" /> Attitude & Body Rates
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'PITCH', v: pitch, u: '°', c: '#22d3ee' },
              { label: 'ROLL', v: roll, u: '°', c: '#f59e0b' },
              { label: 'YAW', v: yaw, u: '°', c: '#a78bfa' },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-[#0a1220] border border-white/10 py-3">
                <div className="text-[9px] font-mono text-[#8fa3b8]">{x.label}</div>
                <div className="text-lg font-mono font-bold" style={{ color: x.c }}>{x.v.toFixed(1)}{x.u}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center mt-3">
            {[
              { label: 'ROLL RATE', v: (rate.x * 180) / Math.PI },
              { label: 'PITCH RATE', v: (rate.y * 180) / Math.PI },
              { label: 'YAW RATE', v: (rate.z * 180) / Math.PI },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-[#0a1220] border border-white/10 py-2">
                <div className="text-[8px] font-mono text-[#8fa3b8]">{x.label}</div>
                <div className="text-sm font-mono font-bold text-[#cbd5e1]">{x.v.toFixed(0)}<span className="text-[9px] text-[#8fa3b8]">°/s</span></div>
              </div>
            ))}
          </div>
        </div>

        {/* Tapes */}
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-3 flex items-center gap-1.5">
            <ArrowUp className="w-3.5 h-3.5 text-[#1ebcbd]" /> Altitude & Vertical Speed
          </div>
          <div className="flex items-start justify-around">
            <VerticalTape label="ALT" value={altitude} unit="m AGL" color="#34d399" />
            <VerticalTape label="V/S" value={climbRate} unit="m/s" color="#22d3ee" />
          </div>
        </div>

        {/* Stability gauge */}
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4 flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#1ebcbd]" /> Stability Index
          </div>
          <div className="flex-1 flex items-center justify-center">
            <svg viewBox="0 0 120 120" className="w-36 h-36">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#1f2937" strokeWidth="10" />
              <circle cx="60" cy="60" r="50" fill="none" stroke={stabColor} strokeWidth="10"
                strokeLinecap="round" strokeDasharray={`${(stability.score / 100) * 314} 314`}
                transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 0.2s' }} />
              <text x="60" y="58" fill={stabColor} fontSize="30" fontFamily="monospace" fontWeight="bold" textAnchor="middle">{stability.score}</text>
              <text x="60" y="76" fill="#8fa3b8" fontSize="9" fontFamily="monospace" textAnchor="middle">/ 100</text>
            </svg>
          </div>
          <div className="text-center text-[10px] font-mono text-[#8fa3b8]">
            Body-rate RMS {((stability.rms * 180) / Math.PI).toFixed(1)}°/s
          </div>
        </div>
      </div>

      {/* Maneuver readout + rate trace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-3 flex items-center gap-1.5">
            <RotateCw className="w-3.5 h-3.5 text-[#1ebcbd]" /> Detected Maneuver
          </div>
          <div className="flex flex-col gap-2">
            {maneuvers.map((m, i) => (
              <div key={i} className="rounded-lg bg-[#0a1220] border border-[#1ebcbd]/20 px-3 py-2 text-sm font-mono font-bold text-[#8ae8e9]">
                {m}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0f0f13] p-4 lg:col-span-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#8fa3b8] mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-[#1ebcbd]" /> Body-Rate Trace (±120°/s)</span>
            <span className="flex items-center gap-3">
              <span className="text-[#f59e0b]">■ roll</span>
              <span className="text-[#22d3ee]">■ pitch</span>
              <span className="text-[#a78bfa]">■ yaw</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${traceW} ${traceH}`} className="w-full h-28 rounded-lg bg-[#0a1220] border border-white/10">
            <line x1="0" y1={traceH / 2} x2={traceW} y2={traceH / 2} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
            <polyline points={toTrace('rx')} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
            <polyline points={toTrace('ry')} fill="none" stroke="#22d3ee" strokeWidth="1.5" />
            <polyline points={toTrace('rz')} fill="none" stroke="#a78bfa" strokeWidth="1.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}

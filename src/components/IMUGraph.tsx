import React, { useEffect, useRef, useState } from 'react';
import { Activity, Gauge } from 'lucide-react';
import { ImuMessage } from '../types';

interface IMUGraphProps {
  imu: ImuMessage | null;
  ros2Connected: boolean;
}

const WINDOW_SEC = 12;
const MAX_SAMPLES = 240; // fixed-size ring buffer — flat memory even on a long flight

interface Sample {
  t: number; // seconds since first sample
  pitch: number; roll: number; yaw: number;
  rateX: number; rateY: number; rateZ: number;
}

export default function IMUGraph({ imu, ros2Connected }: IMUGraphProps) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [view, setView] = useState<'attitude' | 'rates'>('attitude');
  const t0Ref = useRef<number | null>(null);

  useEffect(() => {
    if (!imu) return;
    const now = performance.now() / 1000;
    if (t0Ref.current === null) t0Ref.current = now;
    const sample: Sample = {
      t: now - t0Ref.current,
      pitch: imu.pitch, roll: imu.roll, yaw: imu.yaw,
      rateX: imu.rate.x, rateY: imu.rate.y, rateZ: imu.rate.z,
    };
    setSamples(prev => {
      const next = [...prev, sample];
      const cutoff = sample.t - WINDOW_SEC;
      const trimmed = next.filter(s => s.t >= cutoff);
      return trimmed.length > MAX_SAMPLES ? trimmed.slice(trimmed.length - MAX_SAMPLES) : trimmed;
    });
  }, [imu]);

  const width = 100, height = 100;
  const tMax = samples.length ? samples[samples.length - 1].t : WINDOW_SEC;
  const tMin = tMax - WINDOW_SEC;

  const attitudeRange = 45; // +/- degrees
  const rateRange = 2.0; // +/- rad/s

  const toPath = (key: 'pitch' | 'roll' | 'yaw' | 'rateX' | 'rateY' | 'rateZ', range: number) =>
    samples
      .map(s => {
        const x = ((s.t - tMin) / WINDOW_SEC) * width;
        const y = height / 2 - (s[key] / range) * (height / 2);
        return `${x.toFixed(2)},${Math.max(0, Math.min(height, y)).toFixed(2)}`;
      })
      .join(' ');

  const series = view === 'attitude'
    ? [
        { key: 'pitch' as const, color: '#22d3ee', label: 'Pitch' },
        { key: 'roll' as const, color: '#f59e0b', label: 'Roll' },
        { key: 'yaw' as const, color: '#a78bfa', label: 'Yaw' },
      ]
    : [
        { key: 'rateX' as const, color: '#22d3ee', label: 'Rate X' },
        { key: 'rateY' as const, color: '#f59e0b', label: 'Rate Y' },
        { key: 'rateZ' as const, color: '#a78bfa', label: 'Rate Z' },
      ];
  const range = view === 'attitude' ? attitudeRange : rateRange;

  const latest = samples[samples.length - 1];

  return (
    <div className="bg-[#141417] backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-[#ffd02c]" />
          <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">
            IMU Stability
          </h3>
          {!ros2Connected && (
            <span className="text-[9px] text-[#7c7c84] font-mono uppercase">(no live IMU — sim mode)</span>
          )}
        </div>
        <div className="flex bg-[#1c1c20] p-0.5 border border-white/10 rounded-lg">
          <button
            onClick={() => setView('attitude')}
            className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer ${
              view === 'attitude' ? 'bg-[#ffd02c]/10 text-[#ffd02c] border border-[#ffd02c]/30' : 'text-[#9a9aa2]'
            }`}
          >
            Attitude
          </button>
          <button
            onClick={() => setView('rates')}
            className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer ${
              view === 'rates' ? 'bg-[#ffd02c]/10 text-[#ffd02c] border border-[#ffd02c]/30' : 'text-[#9a9aa2]'
            }`}
          >
            Rates
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-32 bg-[#0a0a0c]/90 rounded-lg border border-white/5">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#334155" strokeWidth="0.5" />
        {series.map(s => (
          <polyline
            key={s.key}
            points={toPath(s.key, range)}
            fill="none"
            stroke={s.color}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="flex items-center justify-between mt-2 text-[9.5px] font-mono">
        <div className="flex items-center space-x-3">
          {series.map(s => (
            <span key={s.key} className="flex items-center gap-1" style={{ color: s.color }}>
              <span className="w-2 h-0.5 inline-block" style={{ background: s.color }} />
              {s.label}: {latest ? latest[s.key].toFixed(1) : '0.0'}{view === 'attitude' ? '°' : ' rad/s'}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1 text-[#7c7c84]">
          <Gauge className="w-3 h-3" /> last {WINDOW_SEC}s
        </span>
      </div>
    </div>
  );
}

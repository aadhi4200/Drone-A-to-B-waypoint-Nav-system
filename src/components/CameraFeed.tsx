import React, { useState, useEffect, useRef } from 'react';
import { Camera, Wifi, WifiOff, Maximize2, RotateCcw } from 'lucide-react';
import { FlightState, LatLng, Obstacle, SensorOrientation } from '../types';

const API_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";

interface CameraFeedProps {
  dronePos:    { lat: number; lng: number; heading: number };
  flightState: FlightState;
  destLoc:     LatLng | null;
  obstacles:   Obstacle[];
  sensors:     SensorOrientation;
}

export default function CameraFeed({
  dronePos,
  flightState,
  destLoc,
  sensors,
}: CameraFeedProps) {

  const [ros2Connected, setRos2Connected] = useState(false);
  const [streamError,   setStreamError]   = useState(false);
  const [fullscreen,    setFullscreen]     = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // ── Check if backend is reachable ─────────────
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/mission/status`);
        if (res.ok) setRos2Connected(true);
        else        setRos2Connected(false);
      } catch {
        setRos2Connected(false);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* ── Live ROS2 Camera Feed ── */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="bg-slate-950/40 px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            <h4 className="font-semibold text-white text-xs uppercase font-mono">
              Downward Camera Feed
            </h4>
            {/* Live dot */}
            {ros2Connected && !streamError && (
              <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Connection badge */}
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 ${
              ros2Connected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}>
              {ros2Connected
                ? <><Wifi className="w-3 h-3" /> ROS2 LIVE</>
                : <><WifiOff className="w-3 h-3" /> OFFLINE</>
              }
            </span>
            {/* Fullscreen toggle */}
            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Camera image */}
        <div className={`relative bg-slate-950 ${fullscreen ? 'fixed inset-0 z-50' : 'h-64'}`}>
          {ros2Connected ? (
            <>
              {/* MJPEG stream — browser handles it natively */}
              <img
                ref={imgRef}
                src={`${API_URL}/camera/stream`}
                alt="Drone downward camera"
                className="w-full h-full object-contain"
                onError={() => setStreamError(true)}
                onLoad={()  => setStreamError(false)}
              />

              {/* Crosshair overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative w-8 h-8">
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-400/60" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-400/60" />
                  <div className="absolute inset-2 rounded-full border border-cyan-400/40" />
                </div>
              </div>

              {/* Telemetry overlay — bottom left */}
              <div className="absolute bottom-2 left-2 font-mono text-[9px] space-y-0.5 pointer-events-none">
                <div className="bg-slate-950/70 px-2 py-1 rounded text-cyan-300">
                  ALT: {sensors.barometerAltitudeM.toFixed(1)}m
                </div>
                <div className="bg-slate-950/70 px-2 py-1 rounded text-emerald-300">
                  HDG: {dronePos.heading.toFixed(0)}°
                </div>
                <div className={`bg-slate-950/70 px-2 py-1 rounded font-bold ${
                  flightState === FlightState.EN_ROUTE
                    ? 'text-cyan-400'
                    : flightState === FlightState.EMERGENCY_LANDING
                    ? 'text-red-400 animate-pulse'
                    : 'text-slate-400'
                }`}>
                  {flightState}
                </div>
              </div>

              {/* Stream error overlay */}
              {streamError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80">
                  <RotateCcw className="w-8 h-8 text-slate-500 animate-spin mb-2" />
                  <p className="text-slate-400 text-xs font-mono">
                    Reconnecting to camera...
                  </p>
                </div>
              )}

              {/* Fullscreen close button */}
              {fullscreen && (
                <button
                  onClick={() => setFullscreen(false)}
                  className="absolute top-4 right-4 bg-slate-950/80 text-white px-3 py-1.5 rounded-lg text-xs font-mono border border-white/10"
                >
                  Close ✕
                </button>
              )}
            </>
          ) : (
            /* Offline placeholder */
            <div className="w-full h-full flex flex-col items-center justify-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center">
                <Camera className="w-8 h-8 text-slate-600" />
              </div>
              <div className="text-center">
                <p className="text-slate-400 text-xs font-mono font-bold">
                  CAMERA OFFLINE
                </p>
                <p className="text-slate-600 text-[10px] font-mono mt-1">
                  Start FastAPI backend to enable live feed
                </p>
                <p className="text-slate-700 text-[10px] font-mono mt-0.5">
                  python backend/main.py
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-950/40 px-4 py-2 border-t border-white/10 flex justify-between text-[10px] text-slate-500 font-mono">
          <span>Source: /camera/image_raw → MJPEG → React</span>
          <span>
            {ros2Connected
              ? `${API_URL}/camera/stream`
              : 'Backend offline'}
          </span>
        </div>
      </div>

      {/* ── ArUco Detection Status ── */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        <div className="bg-slate-950/40 px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Camera className="w-4 h-4 text-amber-400" />
            <h4 className="font-semibold text-white text-xs uppercase font-mono">
              ArUco Detection Status
            </h4>
          </div>
          <span className="text-[9px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20">
            ID = 17
          </span>
        </div>

        <div className="p-4 space-y-3">

          {/* Pixel offset display */}
          <div className="grid grid-cols-3 gap-2 font-mono">
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10 text-center">
              <div className="text-[9px] text-slate-400 uppercase mb-1">Offset X</div>
              <div className="text-sm font-bold text-cyan-400">0.0 px</div>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10 text-center">
              <div className="text-[9px] text-slate-400 uppercase mb-1">Offset Y</div>
              <div className="text-sm font-bold text-cyan-400">0.0 px</div>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10 text-center">
              <div className="text-[9px] text-slate-400 uppercase mb-1">Area</div>
              <div className="text-sm font-bold text-amber-400">0 px²</div>
            </div>
          </div>

          {/* Landing state */}
          <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10 font-mono">
            <div className="text-[9px] text-slate-400 uppercase mb-2">Landing State</div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${
                flightState === FlightState.EN_ROUTE
                  ? 'bg-cyan-400 animate-ping'
                  : 'bg-slate-600'
              }`} />
              <span className="text-xs font-bold text-white">
                {flightState === FlightState.EN_ROUTE
                  ? 'SEARCH → ALIGN → DESCEND → LAND'
                  : 'IDLE — waiting for mission'}
              </span>
            </div>
          </div>

          {/* Visual indicator grid */}
          <div className="bg-slate-950/60 rounded-xl border border-white/10 p-4 flex items-center justify-center h-28 relative">
            {/* Center crosshair grid */}
            <svg width="100%" height="100%" viewBox="0 0 200 120" className="absolute inset-0">
              {/* Grid */}
              <line x1="100" y1="0" x2="100" y2="120" stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
              <line x1="0" y1="60" x2="200" y2="60" stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
              {/* Crosshair */}
              <line x1="90" y1="60" x2="110" y2="60" stroke="#06b6d4" strokeWidth="1.5" />
              <line x1="100" y1="50" x2="100" y2="70" stroke="#06b6d4" strokeWidth="1.5" />
              <circle cx="100" cy="60" r="15" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.4" />
              <circle cx="100" cy="60" r="30" fill="none" stroke="#06b6d4" strokeWidth="0.5" strokeOpacity="0.2" />
              {/* Marker placeholder */}
              <rect
                x="85" y="45" width="30" height="30"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3,2"
                opacity={flightState === FlightState.EN_ROUTE ? 0.8 : 0.2}
              />
            </svg>
            <span className="text-[10px] font-mono text-slate-500 z-10">
              {flightState === FlightState.EN_ROUTE
                ? 'Scanning for ArUco ID=17...'
                : 'Detection inactive'}
            </span>
          </div>

          <div className="text-[10px] font-mono text-slate-600 text-center">
            Topic: /vision/landing_target → pixel offset → velocity corrections
          </div>
        </div>
      </div>

    </div>
  );
}
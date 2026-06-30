import React, { useState, useEffect, useRef } from 'react';
import { Camera, Compass, ShieldAlert, ZoomIn, Activity } from 'lucide-react';
import { LatLng, Obstacle, FlightState, SensorOrientation } from '../types';

interface CameraFeedProps {
  dronePos: { lat: number; lng: number; heading: number };
  flightState: FlightState;
  destLoc: LatLng | null;
  obstacles: Obstacle[];
  sensors: SensorOrientation;
}

export default function CameraFeed({
  dronePos,
  flightState,
  destLoc,
  obstacles,
  sensors
}: CameraFeedProps) {
  const [activeLayout, setActiveLayout] = useState<'split' | 'feed1' | 'feed2'>('split');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [gimbalTilt, setGimbalTilt] = useState<number>(-12); // Gimbal angle
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const noiseIntensity = 0; // Absolute noise-free clear camera signal

  // Canvas refs for drawing high-tech animated wireframes
  const canvasRef1 = useRef<HTMLCanvasElement>(null);
  const canvasRef2 = useRef<HTMLCanvasElement>(null);

  const animationRef = useRef<number | null>(null);

  // Artificial horizon variables
  const pitchOffsetRef = useRef<number>(0);
  const rollAngleRef = useRef<number>(0);

  // Loop to animate visible spectrum & optical downward nav tracking
  useEffect(() => {
    let frame = 0;

    const render = () => {
      frame++;

      // Adjust pitch/roll targets during flight
      if (flightState === FlightState.EN_ROUTE) {
        pitchOffsetRef.current = Math.sin(Date.now() * 0.003) * 12 - 5;
        rollAngleRef.current = Math.cos(Date.now() * 0.002) * 8;
      } else if (flightState === FlightState.EMERGENCY_LANDING) {
        pitchOffsetRef.current = Math.sin(Date.now() * 0.01) * 3 - 2;
        rollAngleRef.current = Math.sin(Date.now() * 0.008) * 15;
      } else {
        pitchOffsetRef.current = -5; // default rest position
        rollAngleRef.current = 0;
      }

      // Render Feed 1 (FPV Visible Spectrum Front Gimbal)
      const c1 = canvasRef1.current;
      if (c1) {
        const ctx = c1.getContext('2d');
        if (ctx) {
          const w = c1.width;
          const h = c1.height;
          ctx.clearRect(0, 0, w, h);

          // 1. Dark matte tech background
          ctx.fillStyle = '#070b13';
          ctx.fillRect(0, 0, w, h);

          // 2. Draw Subtle Blueprint grids
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
          ctx.lineWidth = 1;
          for (let i = 0; i < w; i += 30) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
          }
          for (let j = 0; j < h; j += 30) {
            ctx.beginPath();
            ctx.moveTo(0, j);
            ctx.lineTo(w, j);
            ctx.stroke();
          }

          // 3. Circular crosshairs
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.12)';
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, 45, 0, 2 * Math.PI);
          ctx.arc(w / 2, h / 2, 90, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(w / 2 - 100, h / 2);
          ctx.lineTo(w / 2 - 15, h / 2);
          ctx.moveTo(w / 2 + 15, h / 2);
          ctx.lineTo(w / 2 + 100, h / 2);
          ctx.moveTo(w / 2, h / 2 - 50);
          ctx.lineTo(w / 2, h / 2 - 15);
          ctx.moveTo(w / 2, h / 2 + 15);
          ctx.lineTo(w / 2, h / 2 + 50);
          ctx.stroke();

          // 4. Central Diagnostic Panel with Explicit Statuses
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(w / 2 - 140, h / 2 - 35, 280, 70);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(w / 2 - 140, h / 2 - 35, 280, 70);

          // Warnings/Status text (Blinking dot support)
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ VIDEO RX STREAM: NO SIGNAL', w / 2, h / 2 - 11);

          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 10px monospace';
          const isBlink = Math.floor(frame / 30) % 2 === 0;
          ctx.fillText(
            isBlink ? '● CAMERA STATUS: CONNECTED (OK)' : '  CAMERA STATUS: CONNECTED (OK)',
            w / 2,
            h / 2 + 13
          );

          ctx.textAlign = 'left';

          // Headers
          ctx.fillStyle = '#06b6d4';
          ctx.font = '9px monospace';
          ctx.fillText(`CAM FLT 1: FPV PRIMARY GIMBAL`, 15, 20);
          ctx.fillText(`HARDWARE PORT: AV_CHANNEL_01 (CONNECTED)`, 15, h - 15);
        }
      }

      // Render Feed 2 (Downward Optical Nav-Cam terrain blueprint mapping)
      const c2 = canvasRef2.current;
      if (c2) {
        const ctx = c2.getContext('2d');
        if (ctx) {
          const w = c2.width;
          const h = c2.height;
          ctx.clearRect(0, 0, w, h);

          // 1. Dark matte tech background
          ctx.fillStyle = '#070b13';
          ctx.fillRect(0, 0, w, h);

          // 2. Draw Subtle Blueprint grids
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
          ctx.lineWidth = 1;
          for (let i = 0; i < w; i += 30) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
          }
          for (let j = 0; j < h; j += 30) {
            ctx.beginPath();
            ctx.moveTo(0, j);
            ctx.lineTo(w, j);
            ctx.stroke();
          }

          // 3. Circular crosshairs
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.12)';
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, 45, 0, 2 * Math.PI);
          ctx.arc(w / 2, h / 2, 90, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(w / 2 - 100, h / 2);
          ctx.lineTo(w / 2 - 15, h / 2);
          ctx.moveTo(w / 2 + 15, h / 2);
          ctx.lineTo(w / 2 + 100, h / 2);
          ctx.moveTo(w / 2, h / 2 - 50);
          ctx.lineTo(w / 2, h / 2 - 15);
          ctx.moveTo(w / 2, h / 2 + 15);
          ctx.lineTo(w / 2, h / 2 + 50);
          ctx.stroke();

          // 4. Central Diagnostic Panel with Explicit Statuses
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(w / 2 - 140, h / 2 - 35, 280, 70);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(w / 2 - 140, h / 2 - 35, 280, 70);

          // Warnings/Status text (Blinking dot support)
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ VIDEO RX STREAM: NO SIGNAL', w / 2, h / 2 - 11);

          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 10px monospace';
          const isBlink = Math.floor(frame / 30) % 2 === 0;
          ctx.fillText(
            isBlink ? '● CAMERA STATUS: CONNECTED (OK)' : '  CAMERA STATUS: CONNECTED (OK)',
            w / 2,
            h / 2 + 13
          );

          ctx.textAlign = 'left';

          // Headers
          ctx.fillStyle = '#06b6d4';
          ctx.font = '9px monospace';
          ctx.fillText(`CAM FLT 2: DOWNWARD NAVIGATION NAV-CAM`, 15, 20);
          ctx.fillText(`HARDWARE PORT: AV_CHANNEL_02 (CONNECTED)`, 15, h - 15);
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dronePos, destLoc, obstacles, zoomLevel, noiseIntensity, gimbalTilt, showGrid, flightState, sensors]);

  return (
    <div id="uav-camera-viewfinder-hub" className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-auto max-w-full">
      {/* Header bar */}
      <div className="bg-slate-950/60 px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 font-mono">
        <div className="flex items-center space-x-2">
          <Camera className="w-5 h-5 text-cyan-400 animate-pulse" />
          <div>
            <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">Simulated Optical Gimbal Hub</h3>
            <p className="text-[10px] text-slate-400">FPV dual viewport feeds with target tracing HUD & ground navigation cameras</p>
          </div>
        </div>

        {/* View Selection Row */}
        <div className="flex items-center space-x-2">
          <div className="flex bg-slate-950/60 p-0.5 border border-white/10 rounded-lg text-[10px] uppercase font-bold text-slate-400">
            <button
              id="btn-layout-split"
              onClick={() => setActiveLayout('split')}
              className={`px-2 py-1 rounded transition-all cursor-pointer ${
                activeLayout === 'split' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'hover:text-white'
              }`}
            >
              Split View
            </button>
            <button
              id="btn-layout-feed1"
              onClick={() => setActiveLayout('feed1')}
              className={`px-2 py-1 rounded transition-all cursor-pointer ${
                activeLayout === 'feed1' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'hover:text-white'
              }`}
            >
              Feed 1 (FPV)
            </button>
            <button
              id="btn-layout-feed2"
              onClick={() => setActiveLayout('feed2')}
              className={`px-2 py-1 rounded transition-all cursor-pointer ${
                activeLayout === 'feed2' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'hover:text-white'
              }`}
            >
              Feed 2 (Nav-Cam)
            </button>
          </div>
        </div>
      </div>

      {/* Camera Stage Container */}
      <div className={`p-4 gap-4 bg-slate-950/30 grid ${
        activeLayout === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
      }`}>
        
        {/* Feed 1 Panel */}
        {(activeLayout === 'split' || activeLayout === 'feed1') && (
          <div className="relative border border-white/10 bg-slate-950 rounded-xl overflow-hidden aspect-video flex flex-col shadow-inner">
            <canvas
              ref={canvasRef1}
              width={480}
              height={270}
              className="w-full h-full object-cover"
            />

            {/* FPV Live Indicator overlays */}
            <div className="absolute top-3 right-3 flex items-center space-x-2 bg-slate-950/80 border border-white/10 px-2 py-1 rounded font-mono text-[9px] text-slate-300">
              {isRecording ? (
                <div className="flex items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 mr-1.5 animate-ping"></span>
                  <span className="text-red-400 font-bold">REC</span>
                </div>
              ) : (
                <span className="text-slate-400">STANBY</span>
              )}
              <span className="text-slate-500">|</span>
              <span>1080P PRO</span>
              <span className="text-slate-500">|</span>
              <span>{flightState === FlightState.EN_ROUTE ? '60.0 FPS' : '30.0 FPS'}</span>
            </div>

            {/* Hazard avoidance warn box */}
            {sensors.obstacleAvoidanceActive && (
              <div className="absolute bottom-3 left-3 bg-red-950/90 border border-red-500 text-red-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-mono text-[9.5px] font-bold animate-pulse shadow-lg">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span>TRAJECTORY HAZARD WARNING LOCK: {sensors.obstacleType || 'Obstacle near'}</span>
              </div>
            )}
          </div>
        )}

        {/* Feed 2 Panel */}
        {(activeLayout === 'split' || activeLayout === 'feed2') && (
          <div className="relative border border-white/10 bg-slate-950 rounded-xl overflow-hidden aspect-video flex flex-col shadow-inner">
            <canvas
              ref={canvasRef2}
              width={480}
              height={270}
              className="w-full h-full object-cover"
            />

            {/* Live indicator layout overlay */}
            <div className="absolute top-3 right-3 flex items-center space-x-2 bg-slate-950/80 border border-white/10 px-2 py-1 rounded font-mono text-[9px] text-slate-300">
              <span className="text-cyan-400 font-bold">LIVE TELEM</span>
              <span className="text-slate-500">|</span>
              <span>NAV-CAM</span>
              <span className="text-slate-500">|</span>
              <span>{flightState === FlightState.EN_ROUTE ? '60.0 FPS' : '30.0 FPS'}</span>
            </div>

            {/* Telemetry data ticker */}
            <div className="absolute bottom-3 left-3 bg-slate-950/85 border border-white/10 p-2 rounded-lg font-mono text-[8.5px] text-slate-400 leading-normal backdrop-blur-md">
              <div className="text-white font-bold text-[9px] uppercase tracking-wide flex items-center gap-1 mb-1">
                <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                Downward Scanner Lock
              </div>
              <div>BARO: {sensors.barometerAltitudeM.toFixed(1)}m | LIDAR: {sensors.lidarDistanceM.toFixed(2)}m</div>
              <div>GRID: [WGS84 EQUAT RADIUS]</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Manual Adjusters bar */}
      <div className="bg-slate-950/80 px-4 py-3.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
        
        {/* Zoom adjust */}
        <div className="flex items-center space-x-3 bg-slate-950/40 p-1.5 rounded-xl border border-white/5">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
            Zoom Range
          </span>
          <div className="flex items-center space-x-2">
            {[1, 2, 4, 8].map((z) => (
              <button
                key={z}
                onClick={() => setZoomLevel(z)}
                className={`h-6 w-8 rounded text-[10px] font-bold border cursor-pointer transition-all ${
                  zoomLevel === z 
                    ? 'bg-cyan-500/20 border-cyan-500/35 text-cyan-300' 
                    : 'bg-slate-900 border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>

        {/* Gimbal Controls */}
        <div className="flex items-center space-x-3 bg-slate-950/40 p-1.5 rounded-xl border border-white/5">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '4s' }} />
            Gimbal Pitch: {gimbalTilt}°
          </span>
          <div className="flex items-center space-x-1.5">
            <input
              type="range"
              min={-90}
              max={15}
              value={gimbalTilt}
              onChange={(e) => setGimbalTilt(parseInt(e.target.value))}
              className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Miscellaneous diagnostics toggle */}
        <div className="flex items-center space-x-2 text-[10px] text-slate-400">
          
          {/* Signal Connection Status badge */}
          <div className="flex items-center space-x-2 bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span>CAMERA STABLE: CONNECTED</span>
          </div>

          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`px-2.5 py-1.5 border rounded-lg hover:text-white transition-all cursor-pointer font-bold uppercase tracking-wide ${
              showGrid ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-slate-900 border-white/5 text-slate-500'
            }`}
          >
            HUD Overlay
          </button>

          <button
            onClick={() => setIsRecording(!isRecording)}
            className={`px-2.5 py-1.5 border rounded-lg hover:text-white transition-all cursor-pointer font-bold uppercase tracking-wide ${
              isRecording ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-slate-900 border-white/5 text-slate-500'
            }`}
          >
            {isRecording ? '🔴 ENGAGED' : '⚫ PAUSED'}
          </button>
        </div>

      </div>
    </div>
  );
}

import React from 'react';
import { Thermometer, Wind, Compass, Shield, ShieldCheck, Fan, Flame, Cpu, Gauge } from 'lucide-react';
import { SensorOrientation, ClimateState, SignalState } from '../types';

interface SensorReadoutProps {
  sensors: SensorOrientation;
  climate: ClimateState;
  signal: SignalState;
  speedKmh: number;
  altitudeM: number;
  onToggleHeater: () => void;
  onToggleCooler: () => void;
  onSetEncryptionKey: (key: string) => void;
  onSimulateObstacleAlert: () => void;
  simulationWindSpeed: number;
  onChangeWindSpeed: (val: number) => void;
}

export default function SensorReadout({
  sensors,
  climate,
  signal,
  speedKmh,
  altitudeM,
  onToggleHeater,
  onToggleCooler,
  onSetEncryptionKey,
  onSimulateObstacleAlert,
  simulationWindSpeed,
  onChangeWindSpeed
}: SensorReadoutProps) {
  // Translate yaw to compass direction letter
  const getCompassDirection = (deg: number) => {
    const sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(((deg % 360) / 45)) % 8;
    return sectors[index];
  };

  // Safe percentage helper for lidar distance
  const lidarPercent = Math.min(100, (sensors.lidarDistanceM / 50) * 100);

  return (
    <div id="uav-sensors-and-climate" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 relative z-10">
      
      {/* 1. Spatial Sensors & Orientation Visualized */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Spatial Sensors</h3>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded border border-cyan-500/20">LIVE-STREAM</span>
        </div>

        {/* Dynamic Spatial Graphic */}
        <div className="flex justify-around items-center my-2 py-2.5 bg-slate-950/40 rounded-xl border border-white/10">
          {/* Pitch */}
          <div className="text-center relative">
            <div className="text-[10px] text-slate-400 font-mono mb-1 uppercase">PITCH</div>
            <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center relative overflow-hidden bg-slate-950">
              {/* Pitch bar indicator */}
              <div 
                className="absolute w-12 h-0.5 bg-cyan-400 transition-transform duration-200"
                style={{ transform: `rotate(${sensors.pitch}deg) translateY(${sensors.pitch * 0.5}px)` }}
              />
              <div className="absolute inset-0 border border-cyan-400/10 pointer-events-none" />
              <span className="z-10 text-[11px] font-mono text-cyan-300 font-semibold">{sensors.pitch.toFixed(1)}°</span>
            </div>
          </div>

          {/* Roll */}
          <div className="text-center relative">
            <div className="text-[10px] text-slate-400 font-mono mb-1 uppercase">ROLL</div>
            <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center relative overflow-hidden bg-slate-950">
              {/* Roll line indicator */}
              <div 
                className="absolute w-12 h-0.5 bg-amber-400 transition-transform duration-200"
                style={{ transform: `rotate(${sensors.roll}deg)` }}
              />
              <div className="absolute inset-x-0 h-0.5 bg-dashed bg-slate-800 top-1/2" />
              <span className="z-10 text-[11px] font-mono text-amber-300 font-semibold">{sensors.roll.toFixed(1)}°</span>
            </div>
          </div>

          {/* Yaw */}
          <div className="text-center relative">
            <div className="text-[10px] text-slate-400 font-mono mb-1 uppercase">YAW</div>
            <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center relative overflow-hidden bg-slate-950">
              {/* Compass marker */}
              <div 
                className="absolute text-[8px] text-red-500 transition-transform duration-200 font-mono"
                style={{ transform: `rotate(${sensors.yaw}deg) translateY(-20px)` }}
              >
                ▲
              </div>
              <span className="text-[11px] font-mono text-white font-bold">{sensors.yaw.toFixed(0)}°</span>
              <span className="absolute bottom-1 text-[9px] font-mono text-slate-400 font-semibold">{getCompassDirection(sensors.yaw)}</span>
            </div>
          </div>
        </div>

        {/* Telemetry numbers */}
        <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10 leading-tight">
            <div className="text-[10px] text-slate-400 uppercase">GPS Precision</div>
            <div className="text-white font-bold mt-1">{sensors.gpsAccuracyMothers.toFixed(2)}m (RTK)</div>
          </div>
          <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/10 leading-tight">
            <div className="text-[10px] text-slate-400 uppercase">Baro Altitude</div>
            <div className="text-cyan-400 font-bold mt-1">{sensors.barometerAltitudeM.toFixed(1)}m</div>
          </div>
        </div>
      </div>

      {/* 2. UAV Climate Control & Thermal Stability */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Thermometer className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Thermal Control</h3>
          </div>
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
            climate.thermalThrottling 
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse' 
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            {climate.thermalThrottling ? 'THERMAL LOCK ACTIVE' : 'TEMP STATE SAFE'}
          </span>
        </div>

        {/* Climate Telemetry */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs font-mono">
          <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 uppercase">Battery Temp</div>
              <div className={`text-sm font-bold mt-0.5 ${
                climate.batteryTempC > 45 ? 'text-red-400' : climate.batteryTempC < 15 ? 'text-cyan-400' : 'text-emerald-300'
              }`}>{climate.batteryTempC.toFixed(1)}°C</div>
            </div>
            {climate.batteryTempC > 45 ? (
              <span className="p-1 px-1.5 rounded bg-red-400/10 text-red-500 text-[10px] uppercase font-bold text-center">Hot</span>
            ) : climate.batteryTempC < 15 ? (
              <span className="p-1 px-1.5 rounded bg-cyan-400/15 text-cyan-400 text-[10px] uppercase font-bold text-center">Cold</span>
            ) : (
              <span className="p-1 px-1.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] uppercase font-bold text-center">Optimal</span>
            )}
          </div>

          <div className="bg-slate-950/40 p-3 rounded-xl border border-white/10">
            <div className="text-[10px] text-slate-400 uppercase">Air Density</div>
            <div className="text-white text-sm font-bold mt-0.5">{climate.airDensityKgM3.toFixed(3)} kg/m³</div>
          </div>
        </div>

        {/* Climate Actuator Actions */}
        <div className="space-y-3">
          <div className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">Actuator Manual Overrides</div>
          
          <div className="grid grid-cols-2 gap-2">
            <button
              id="btn-batter-heater-toggle"
              onClick={onToggleHeater}
              className={`p-2.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 border transition-all cursor-pointer ${
                climate.heaterActive 
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-md' 
                  : 'bg-slate-950/45 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${climate.heaterActive ? 'animate-pulse text-amber-400' : ''}`} />
              <span>Heater: {climate.heaterActive ? 'ON' : 'OFF'}</span>
            </button>

            <button
              id="btn-cooling-fan-toggle"
              onClick={onToggleCooler}
              className={`p-2.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 border transition-all cursor-pointer ${
                climate.coolerActive 
                  ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400 shadow-md' 
                  : 'bg-slate-950/45 border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Fan className={`w-3.5 h-3.5 ${climate.coolerActive ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Fans: {climate.coolerActive ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Wind Stability Slider */}
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex justify-between items-center text-[10px] font-mono mb-1.5 text-slate-400">
            <span className="flex items-center uppercase"><Wind className="w-3 h-3 mr-1 text-cyan-400" /> Wind Turbulence Rate</span>
            <span className="text-white font-bold">{climate.windSpeedKnots.toFixed(1)} Knots</span>
          </div>
          <input
            id="slider-wind-speed"
            type="range"
            min="0"
            max="45"
            step="0.5"
            value={simulationWindSpeed}
            onChange={(e) => onChangeWindSpeed(parseFloat(e.target.value))}
            className="w-full h-1 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <div className="flex justify-between text-[8px] text-slate-500 font-mono mt-0.5">
            <span>0 KT (CALM)</span>
            <span>20 KT (MOD)</span>
            <span>45 KT (SEVERE GALE)</span>
          </div>
        </div>
      </div>

      {/* 3. Encrypted Communication Configuration */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white tracking-wide text-sm uppercase font-display">Secure Comms</h3>
          </div>
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
            signal.isEncrypted 
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
              : 'bg-red-500/10 text-red-500 border-red-500/20 animate-pulse'
          }`}>
            {signal.isEncrypted ? 'LINK ENCRYPTED' : 'UNSECURED WARNING'}
          </span>
        </div>

        {/* Security Parameters */}
        <div className="space-y-4">
          <div className="bg-slate-950/40 border border-white/10 rounded-xl p-3 leading-tight backdrop-blur-sm">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 uppercase">
              <span>Active Protocol</span>
              <span className={`flex items-center text-xs font-bold leading-none ${signal.isEncrypted ? 'text-emerald-400' : 'text-red-400'}`}>
                {signal.isEncrypted ? <ShieldCheck className="w-3.5 h-3.5 mr-1" /> : null}
                {signal.protocol}
              </span>
            </div>
            <div className="text-xs text-white font-mono font-semibold mt-2.5 break-all bg-slate-950/80 p-2 rounded-lg border border-white/5">
              <span className="text-cyan-400 text-[10px] block mr-1 uppercase select-none">AES-256 HMAC Key:</span>
              <span className="text-cyan-300">{signal.encryptionKey || "NULL (DEFAULT_UNSAFE)"}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-slate-400 font-mono tracking-wider uppercase block">Hex Encryption Key Input</label>
            <div className="flex space-x-2">
              <input
                id="input-encryption-hex"
                type="text"
                placeholder="256-bit Hexadecimal Key..."
                defaultValue={signal.encryptionKey}
                onChange={(e) => onSetEncryptionKey(e.target.value)}
                maxLength={64}
                className="flex-1 bg-slate-950/40 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500/45 transition-all"
              />
            </div>
            <span className="text-[9px] text-slate-500 font-mono leading-tight block">
              Changing this hex key alters the dynamic encryption SHA256 block hash calculated for Spring Boot payloads.
            </span>
          </div>
        </div>

        {/* Obstacle Avoidance Control */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-[10.5px] font-mono text-slate-300 font-semibold uppercase">LIDAR Obstacle Scan</div>
              <div className="text-[10px] text-slate-400 font-mono">
                {sensors.obstacleAvoidanceActive ? 'AVOIDANCE MODE ACTIVE' : 'GRID MONITORED SAFE'}
              </div>
            </div>
            <button
              id="btn-simulate-obstacle"
              onClick={onSimulateObstacleAlert}
              className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white font-mono border border-rose-500/30 transition-all shadow cursor-pointer"
            >
              Trigger Obstacle
            </button>
          </div>
        </div>
      </div>
      
    </div>
  );
}

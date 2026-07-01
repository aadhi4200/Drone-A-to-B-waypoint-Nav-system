import React, { useState, useEffect, useRef } from 'react';
import { uploadWaypoints, abortMission, getMissionStatus } from './api';
// NOTE: We import our api functions but rename the local startMission
// to avoid conflict with the imported one
import { startMission as ros2Start } from './api';
import {
  ShieldAlert, Zap, Radio, AlertTriangle,
  MapPin, Download, Check, Copy, KeyRound
} from 'lucide-react';
import { FlightState, LatLng, BatteryState, SignalState, ClimateState, SensorOrientation, TelemetryLog, Obstacle } from './types';
import MapPane from './components/MapPane';
import FlightControlPanel from './components/FlightControlPanel';
import SensorReadout from './components/SensorReadout';
import TelemetryTerminal, { TelemetryLogStream, TelemetryInsights } from './components/TelemetryTerminal';
import CameraFeed from './components/CameraFeed';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY !== '';

const STATIC_OBSTACLES: Obstacle[] = [
  { id: "obs_crane_1",  lat: 9.969200, lng: 76.244800, radiusMeters: 45, heightMeters: 35, type: "Harbour Gantry Crane" },
  { id: "obs_mast_2",   lat: 9.961500, lng: 76.236000, radiusMeters: 35, heightMeters: 42, type: "Navigational Beacon Mast" },
  { id: "obs_tower_3",  lat: 9.974000, lng: 76.233500, radiusMeters: 40, heightMeters: 48, type: "High-Voltage Power Pylon" },
];

export default function App() {
  // ── Core location state ─────────────────────────────
  const [startLoc,   setStartLoc]   = useState<LatLng>({ lat: 9.965800, lng: 76.242100 });
  const [destLoc,    setDestLoc]    = useState<LatLng | null>({ lat: 9.973500, lng: 76.248500 });
  const [dronePos,   setDronePos]   = useState({ lat: 9.965800, lng: 76.242100, heading: 0 });
  const [obstacles,  setObstacles]  = useState<Obstacle[]>(STATIC_OBSTACLES);

  // ── Path state ──────────────────────────────────────
  const [directPath,       setDirectPath]       = useState<LatLng[]>([]);
  const [plannedPath,      setPlannedPath]      = useState<LatLng[]>([]);
  const [currentPathIndex, setCurrentPathIndex] = useState(0);

  // ── Flight state ────────────────────────────────────
  const [flightState,    setFlightState]    = useState<FlightState>(FlightState.IDLE);
  const [logs,           setLogs]           = useState<TelemetryLog[]>([]);
  const [missionTimeSec, setMissionTimeSec] = useState<number>(0);

  // ── GPS sync ────────────────────────────────────────
  const [gpsSyncStatus, setGpsSyncStatus] = useState<'idle' | 'locating' | 'success' | 'error'>('idle');
  const [gpsSyncError,  setGpsSyncError]  = useState<string | null>(null);

  // ── ROS2 connection state (NEW) ─────────────────────
  const [ros2Connected, setRos2Connected] = useState<boolean>(false);

  // ── Simulation ──────────────────────────────────────
  const [simulationWindSpeed, setSimulationWindSpeed] = useState<number>(8.5);

  const [battery, setBattery] = useState<BatteryState>({
    percentage: 100, voltage: 16.8,
    cellVoltages: [4.20, 4.20, 4.20, 4.20],
    temperatureCelsius: 24.5, healthPercent: 98.6, dischargeRateAmps: 0.15
  });

  const [signal, setSignal] = useState<SignalState>({
    strengthDbm: -48, qualityPercent: 100,
    encryptionKey: "5f8a92b4c7d6e1f0a38b9d7c6e5a4f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f",
    isEncrypted: true, protocol: "AES-256-GCM"
  });

  const [climate, setClimate] = useState<ClimateState>({
    ambientTempC: 18.2, batteryTempC: 24.5,
    heaterActive: false, coolerActive: false,
    windSpeedKnots: 8.5, windDirectionDegrees: 140,
    airDensityKgM3: 1.204, thermalThrottling: false
  });

  const [sensors, setSensors] = useState<SensorOrientation>({
    pitch: 0, roll: 0, yaw: 0,
    gpsAccuracyMothers: 0.02, barometerAltitudeM: 0.0,
    lidarDistanceM: 50.0, obstacleAvoidanceActive: false, obstacleType: null
  });

  const mainTickerInterval = useRef<NodeJS.Timeout | null>(null);
  const logTickerDivider   = useRef(0);
  const degToMeter         = 111000;

  // ── GPS sync ────────────────────────────────────────
  const syncLaptopLocation = () => {
    if (!('geolocation' in navigator)) {
      setGpsSyncStatus('error');
      setGpsSyncError("Browser does not support geolocation.");
      return;
    }
    setGpsSyncStatus('locating');
    setGpsSyncError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        setStartLoc({ lat: userLat, lng: userLng });
        setDronePos({ lat: userLat, lng: userLng, heading: 0 });
        setDestLoc({ lat: userLat + 0.0075, lng: userLng + 0.0065 });
        setObstacles([
          { id: "local_antenna_1", lat: userLat+0.0034, lng: userLng+0.0028, radiusMeters: 45, heightMeters: 35, type: "RF Antenna Tower" },
          { id: "local_grid_2",    lat: userLat+0.0015, lng: userLng+0.0048, radiusMeters: 38, heightMeters: 42, type: "Electrical Grid Substation" },
          { id: "local_pylon_3",   lat: userLat+0.0049, lng: userLng-0.0035, radiusMeters: 48, heightMeters: 48, type: "Transmission Pylon Zone" },
        ]);
        setGpsSyncStatus('success');
        addNewLogEntry(FlightState.IDLE, `GPS LOCK SUCCESS: Lat:${userLat.toFixed(6)} Lng:${userLng.toFixed(6)}`);
      },
      (error) => {
        setGpsSyncStatus('error');
        const msgs: Record<number, string> = {
          1: "Access Refused. Try opening in a separate tab.",
          2: "Position unavailable.",
          3: "GPS timeout.",
        };
        const msg = msgs[error.code] || error.message;
        setGpsSyncError(msg);
        addNewLogEntry(FlightState.IDLE, `GPS LOCK FAILED: ${msg}`);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  useEffect(() => { syncLaptopLocation(); }, []);
  useEffect(() => { if (startLoc && destLoc) calculateFlightPath(); }, [startLoc, destLoc, obstacles]);

  // ── Simulation tick ─────────────────────────────────
  useEffect(() => {
    if (flightState === FlightState.EN_ROUTE || flightState === FlightState.EMERGENCY_LANDING) {
      mainTickerInterval.current = setInterval(handleSimulationTick, 150);
    } else {
      if (mainTickerInterval.current) {
        clearInterval(mainTickerInterval.current);
        mainTickerInterval.current = null;
      }
    }
    return () => { if (mainTickerInterval.current) clearInterval(mainTickerInterval.current); };
  }, [flightState, plannedPath, currentPathIndex]);

  // ── ROS2 status polling (NEW) ───────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await getMissionStatus();
        setRos2Connected(true);

        // Update drone position from real ROS2 if available
        if (status.lat && status.lon) {
          setDronePos(prev => ({ ...prev, lat: status.lat, lng: status.lon }));
        }

        // Update altitude from ROS2
        if (status.altitude) {
          setSensors(prev => ({ ...prev, barometerAltitudeM: status.altitude }));
        }

        // Sync mission state from ROS2
        if (status.mission_state === "MISSION_COMPLETE" && flightState === FlightState.EN_ROUTE) {
          setFlightState(FlightState.LANDED_SAFE);
          addNewLogEntry(FlightState.LANDED_SAFE, "ROS2: Mission complete — drone landed.");
        }
        if (status.mission_state === "MISSION_ABORT") {
          setFlightState(FlightState.EMERGENCY_LANDING);
          addNewLogEntry(FlightState.EMERGENCY_LANDING, "ROS2: Mission aborted by system.");
        }

      } catch {
        // Backend not reachable — simulation mode
        setRos2Connected(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [flightState]);

  // ── Path calculation ────────────────────────────────
  const calculateFlightPath = () => {
    if (!startLoc || !destLoc) return;
    setFlightState(FlightState.PLANNING);
    setDirectPath([startLoc, destLoc]);

    // Simple obstacle avoidance — add intermediate waypoints
    const waypoints: LatLng[] = [startLoc];
    for (const obs of obstacles) {
      const midLat = (startLoc.lat + destLoc.lat) / 2;
      const midLng = (startLoc.lng + destLoc.lng) / 2;
      const dLat = obs.lat - midLat;
      const dLng = obs.lng - midLng;
      const dist = Math.sqrt(dLat*dLat + dLng*dLng) * degToMeter;
      if (dist < obs.radiusMeters * 3) {
        const perpLat = midLat + dLng * 0.002;
        const perpLng = midLng - dLat * 0.002;
        waypoints.push({ lat: perpLat, lng: perpLng });
      }
    }
    waypoints.push(destLoc);
    setPlannedPath(waypoints);
    setCurrentPathIndex(0);
    setFlightState(FlightState.IDLE);
  };

  // ── Mission start ───────────────────────────────────
  const startMission = async () => {
    if (!destLoc) return;
    if (flightState !== FlightState.IDLE && flightState !== FlightState.PLANNING) return;

    setFlightState(FlightState.EN_ROUTE);
    setMissionTimeSec(0);
    setCurrentPathIndex(0);
    addNewLogEntry(FlightState.EN_ROUTE, "MISSION START: Trajectory execution initiated.");

    // ── Send to ROS2 via FastAPI ──────────────────────
    try {
      await uploadWaypoints([{
        lat:   destLoc.lat,
        lon:   destLoc.lng,
        alt:   5.0,
        label: "B",
      }]);
      await ros2Start();
      addNewLogEntry(FlightState.EN_ROUTE,
        `ROS2: Waypoint sent → (${destLoc.lat.toFixed(6)}, ${destLoc.lng.toFixed(6)})`);
    } catch {
      addNewLogEntry(FlightState.EN_ROUTE,
        "ROS2: Backend not reachable — running in simulation mode only.");
    }
  };

  // ── Emergency override ──────────────────────────────
  const triggerEmergencyOverride = async () => {
    if (flightState !== FlightState.EN_ROUTE) return;
    setFlightState(FlightState.EMERGENCY_LANDING);
    addNewLogEntry(FlightState.EMERGENCY_LANDING, "EMERGENCY OVERRIDE: Forced descent initiated.");

    try {
      await abortMission();
      addNewLogEntry(FlightState.EMERGENCY_LANDING, "ROS2: ABORT sent to drone.");
    } catch {
      addNewLogEntry(FlightState.EMERGENCY_LANDING, "ROS2: Backend not reachable — local emergency only.");
    }
  };

  // ── Reset ───────────────────────────────────────────
  const resetSystem = () => {
    if (mainTickerInterval.current) clearInterval(mainTickerInterval.current);
    setFlightState(FlightState.IDLE);
    setDronePos({ lat: startLoc.lat, lng: startLoc.lng, heading: 0 });
    setMissionTimeSec(0);
    setCurrentPathIndex(0);
    setSensors(prev => ({ ...prev, pitch: 0, roll: 0, yaw: 0, barometerAltitudeM: 0, obstacleAvoidanceActive: false }));
    addNewLogEntry(FlightState.IDLE, "SYSTEM RESET: All telemetry cleared. Drone returned to base.");
  };

  // ── Toggle heater / cooler ──────────────────────────
  const toggleHeater = () => setClimate(p => ({ ...p, heaterActive: !p.heaterActive }));
  const toggleCooler = () => setClimate(p => ({ ...p, coolerActive: !p.coolerActive }));

  // ── Simulation tick logic ───────────────────────────
  const handleSimulationTick = () => {
    if (flightState === FlightState.EN_ROUTE) {
      if (plannedPath.length < 2 || currentPathIndex >= plannedPath.length - 1) return;

      const target = plannedPath[currentPathIndex + 1];
      setDronePos(prev => {
        const dLat = target.lat - prev.lat;
        const dLng = target.lng - prev.lng;
        const dist  = Math.sqrt(dLat*dLat + dLng*dLng);
        const speed = 0.0001;

        if (dist < speed * 1.5) {
          const nextIdx = currentPathIndex + 1;
          setCurrentPathIndex(nextIdx);
          if (nextIdx >= plannedPath.length - 1) {
            setFlightState(FlightState.LANDED_SAFE);
            addNewLogEntry(FlightState.LANDED_SAFE, "LANDING COMPLETE: Destination reached.");
          }
          return { lat: target.lat, lng: target.lng, heading: prev.heading };
        }

        const heading = Math.atan2(dLng, dLat) * (180 / Math.PI);
        return {
          lat: prev.lat + (dLat / dist) * speed,
          lng: prev.lng + (dLng / dist) * speed,
          heading,
        };
      });

      setSensors(prev => ({
        ...prev,
        pitch:              Math.sin(Date.now() * 0.003) * 3,
        roll:               Math.sin(Date.now() * 0.002) * 2,
        barometerAltitudeM: 45 + Math.sin(Date.now() * 0.001) * 2,
        lidarDistanceM:     Math.max(5, 50 - Math.sin(Date.now() * 0.001) * 10),
      }));

      setBattery(prev => ({ ...prev, percentage: Math.max(0, prev.percentage - 0.003) }));
      setMissionTimeSec(prev => prev + 1);

      logTickerDivider.current += 1;
      if (logTickerDivider.current >= 20) {
        logTickerDivider.current = 0;
        addNewLogEntry(FlightState.EN_ROUTE, `EN_ROUTE: Telemetry ingest active.`);
      }
    }

    if (flightState === FlightState.EMERGENCY_LANDING) {
      setSensors(prev => {
        const nextAlt = Math.max(0, prev.barometerAltitudeM - 1.8);
        if (nextAlt === 0) setFlightState(FlightState.LANDED_SAFE);
        return { ...prev, barometerAltitudeM: nextAlt, pitch: prev.pitch * 0.7, roll: prev.roll * 0.7 };
      });
    }
  };

  const formatDuration = (s: number) =>
    `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  // ── Log entry ───────────────────────────────────────
  const addNewLogEntry = (state: FlightState, detail: string) => {
    const formattedDur = missionTimeSec > 0 ? formatDuration(missionTimeSec) : undefined;
    const frame: TelemetryLog = {
      id:                        `UAV-COOPS-${Date.now().toString().slice(-5)}`,
      timestamp:                 new Date().toISOString(),
      flightState:               state,
      latitude:                  dronePos.lat,
      longitude:                 dronePos.lng,
      altitudeMeters:            sensors.barometerAltitudeM,
      headingDegrees:            dronePos.heading,
      batteryPercentage:         battery.percentage,
      batteryTempCelsius:        climate.batteryTempC,
      signalStrengthDbm:         signal.strengthDbm,
      encryptionActive:          signal.isEncrypted,
      pitchDegrees:              sensors.pitch,
      rollDegrees:               sensors.roll,
      yawDegrees:                dronePos.heading,
      lidarDistanceMeters:       sensors.lidarDistanceM,
      obstacleAvoidanceActive:   sensors.obstacleAvoidanceActive,
      emergencyLandingActive:    state === FlightState.EMERGENCY_LANDING,
      ambientTemperatureCelsius: climate.ambientTempC,
      climateHeaterActive:       climate.heaterActive,
      climateCoolerActive:       climate.coolerActive,
      windSpeedKnots:            simulationWindSpeed,
      flightDuration:            formattedDur,
      detail:                    formattedDur ? `${detail} (Elapsed: ${formattedDur})` : detail,
    };
    setLogs(prev => [...prev, frame]);
  };

  // ── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 pb-14 relative overflow-hidden">

      {/* Background grid */}
      <div className="absolute inset-0 z-0 opacity-15 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#334155" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/40 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-cyan-500 rounded flex items-center justify-center font-bold text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              UAV
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white uppercase flex items-center">
                SkyNav Avionics Systems
                <span className="text-cyan-400 text-[9px] font-mono ml-2 bg-white/5 px-2 py-0.5 rounded border border-white/10">v4.2.0-STABLE</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono">Autonomous Drone Mission Control · LiDAR · ROS2 FastAPI Bridge</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* ROS2 connection indicator in header */}
            <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border flex items-center ${
              ros2Connected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-2 ${ros2Connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
              {ros2Connected ? 'ROS2 CONNECTED' : 'SIM MODE'}
            </span>
            <span className="text-[10px] font-mono shrink-0 px-2.5 py-1 bg-white/5 border border-white/10 text-cyan-400 rounded-full flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              PORTAL SECURE
            </span>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-7 relative z-10">

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          <div className="lg:col-span-8 flex flex-col gap-6">
            <MapPane
              apiKey={API_KEY}
              hasValidKey={hasValidKey}
              startLoc={startLoc}
              destLoc={destLoc}
              dronePos={dronePos}
              obstacles={obstacles}
              flightState={flightState}
              onSetStartLoc={setStartLoc}
              onSetDestLoc={setDestLoc}
              plannedPath={plannedPath}
              directPath={directPath}
              avoidanceActive={sensors.obstacleAvoidanceActive}
              emergencyLandingActive={flightState === FlightState.EMERGENCY_LANDING}
            />
            <TelemetryLogStream logs={logs} onClearLogs={() => setLogs([])} />
          </div>

          <div className="lg:col-span-4 flex flex-col gap-6">
            <FlightControlPanel
              startLoc={startLoc}
              destLoc={destLoc}
              dronePos={dronePos}
              flightState={flightState}
              battery={battery}
              signal={signal}
              onSetStartLoc={setStartLoc}
              onSetDestLoc={setDestLoc}
              onPlanPath={calculateFlightPath}
              onLaunchMission={startMission}
              onEmergencyOverride={triggerEmergencyOverride}
              onResetDrone={resetSystem}
              activePathLength={plannedPath.length}
              gpsSyncStatus={gpsSyncStatus}
              gpsSyncError={gpsSyncError}
              onSyncLaptopLocation={syncLaptopLocation}
              missionTimeSec={missionTimeSec}
              ros2Connected={ros2Connected}
            />
            <TelemetryInsights logs={logs} />
          </div>

        </section>

        <section>
          <CameraFeed
            dronePos={dronePos}
            flightState={flightState}
            destLoc={destLoc}
            obstacles={obstacles}
            sensors={sensors}
          />
        </section>

        <section>
          <SensorReadout
            sensors={sensors}
            climate={climate}
            signal={signal}
            speedKmh={flightState === FlightState.EN_ROUTE ? (32.4 + Math.sin(Date.now() * 0.005) * 1.5) : 0}
            altitudeM={sensors.barometerAltitudeM}
            onToggleHeater={toggleHeater}
            onToggleCooler={toggleCooler}
            onSetEncryptionKey={(k) => setSignal(p => ({ ...p, encryptionKey: k, isEncrypted: k !== '' }))}
            onSimulateObstacleAlert={() => {
              setSensors(prev => ({ ...prev, lidarDistanceM: 8.5, obstacleAvoidanceActive: true, obstacleType: "Dynamic Substation Flare" }));
              addNewLogEntry(FlightState.EN_ROUTE, "LIDAR ALERT: Unmapped hazard detected!");
            }}
            simulationWindSpeed={simulationWindSpeed}
            onChangeWindSpeed={setSimulationWindSpeed}
          />
        </section>

      </main>
    </div>
  );
}

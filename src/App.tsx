import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, ShieldCheck, Cpu, Zap, Radio, Thermometer, Wind, AlertTriangle, 
  HelpCircle, Info, Settings, Compass, MapPin, Download, Check, Copy, KeyRound
} from 'lucide-react';
import { FlightState, LatLng, BatteryState, SignalState, ClimateState, SensorOrientation, TelemetryLog, Obstacle } from './types';
import MapPane from './components/MapPane';
import FlightControlPanel from './components/FlightControlPanel';
import SensorReadout from './components/SensorReadout';
import TelemetryTerminal, { TelemetryLogStream, TelemetryInsights } from './components/TelemetryTerminal';
import CameraFeed from './components/CameraFeed';

// Fetch credentials from the AI Studio environment
const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY !== '';

// Default static obstacles situated in Kochi Harbour / Fort Kochi region (Kerala, India)
const STATIC_OBSTACLES: Obstacle[] = [
  {
    id: "obs_crane_1",
    lat: 9.969200,
    lng: 76.244800,
    radiusMeters: 45,
    heightMeters: 35,
    type: "Harbour Gantry Crane"
  },
  {
    id: "obs_mast_2",
    lat: 9.961500,
    lng: 76.236000,
    radiusMeters: 35,
    heightMeters: 42,
    type: "Navigational Beacon Mast"
  },
  {
    id: "obs_tower_3",
    lat: 9.974000,
    lng: 76.233500,
    radiusMeters: 40,
    heightMeters: 48,
    type: "High-Voltage Power Pylon"
  }
];

export default function App() {
  // Coords State (Default Fort Kochi Vasco da Gama Square / Beach Area)
  const [startLoc, setStartLoc] = useState<LatLng>({ lat: 9.965800, lng: 76.242100 });
  const [destLoc, setDestLoc] = useState<LatLng | null>({ lat: 9.973500, lng: 76.248500 });
  const [dronePos, setDronePos] = useState({ lat: 9.965800, lng: 76.242100, heading: 0 });
  const [obstacles, setObstacles] = useState<Obstacle[]>(STATIC_OBSTACLES);

  // Navigation Splines State
  const [directPath, setDirectPath] = useState<LatLng[]>([]);
  const [plannedPath, setPlannedPath] = useState<LatLng[]>([]);
  const [currentPathIndex, setCurrentPathIndex] = useState(0);

  // Flight Operation Engine State
  const [flightState, setFlightState] = useState<FlightState>(FlightState.IDLE);
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [missionTimeSec, setMissionTimeSec] = useState<number>(0);

  // GPS Sync State Tracking
  const [gpsSyncStatus, setGpsSyncStatus] = useState<'idle' | 'locating' | 'success' | 'error'>('idle');
  const [gpsSyncError, setGpsSyncError] = useState<string | null>(null);

  // Climate Custom Setting Simulation
  const [simulationWindSpeed, setSimulationWindSpeed] = useState<number>(8.5);

  // Hardware Metrology Pack State
  const [battery, setBattery] = useState<BatteryState>({
    percentage: 100,
    voltage: 16.8, // 4-Cell configuration max
    cellVoltages: [4.20, 4.20, 4.20, 4.20],
    temperatureCelsius: 24.5,
    healthPercent: 98.6,
    dischargeRateAmps: 0.15
  });

  const [signal, setSignal] = useState<SignalState>({
    strengthDbm: -48,
    qualityPercent: 100,
    encryptionKey: "5f8a92b4c7d6e1f0a38b9d7c6e5a4f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f",
    isEncrypted: true,
    protocol: "AES-256-GCM"
  });

  const [climate, setClimate] = useState<ClimateState>({
    ambientTempC: 18.2,
    batteryTempC: 24.5,
    heaterActive: false,
    coolerActive: false,
    windSpeedKnots: 8.5,
    windDirectionDegrees: 140,
    airDensityKgM3: 1.204,
    thermalThrottling: false
  });

  const [sensors, setSensors] = useState<SensorOrientation>({
    pitch: 0,
    roll: 0,
    yaw: 0,
    gpsAccuracyMothers: 0.02,
    barometerAltitudeM: 0.0,
    lidarDistanceM: 50.0,
    obstacleAvoidanceActive: false,
    obstacleType: null
  });

  // Ticking references
  const mainTickerInterval = useRef<NodeJS.Timeout | null>(null);
  const logTickerDivider = useRef(0);

  // Coordinate geometry conversion ratios (degrees <--> meters)
  const degToMeter = 111000;

  // Unify GPS lock mechanism with robust manual & automatic trigger and UI warnings
  const syncLaptopLocation = () => {
    if (!('geolocation' in navigator)) {
      setGpsSyncStatus('error');
      setGpsSyncError("Browser does not support geolocation.");
      addNewLogEntry(FlightState.IDLE, "GPS FAILURE: Geolocation API unsupported by this browser.");
      return;
    }

    setGpsSyncStatus('locating');
    setGpsSyncError(null);
    addNewLogEntry(FlightState.IDLE, "GPS SYNC: Contacting satellite link for device geolocation...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        
        setStartLoc({ lat: userLat, lng: userLng });
        setDronePos({ lat: userLat, lng: userLng, heading: 0 });
        setDestLoc({ lat: userLat + 0.0075, lng: userLng + 0.0065 });
        
        const localObstacles: Obstacle[] = [
          {
            id: "local_antenna_1",
            lat: userLat + 0.0034,
            lng: userLng + 0.0028,
            radiusMeters: 45,
            heightMeters: 35,
            type: "RF Antenna Tower"
          },
          {
            id: "local_grid_2",
            lat: userLat + 0.0015,
            lng: userLng + 0.0048,
            radiusMeters: 38,
            heightMeters: 42,
            type: "Electrical Grid Substation"
          },
          {
            id: "local_pylon_3",
            lat: userLat + 0.0049,
            lng: userLng - 0.0035,
            radiusMeters: 48,
            heightMeters: 48,
            type: "Transmission Pylon Zone"
          }
        ];
        setObstacles(localObstacles);
        setGpsSyncStatus('success');
        addNewLogEntry(FlightState.IDLE, `GPS LOCK SUCCESS: Laptop coordinates verified! Lat: ${userLat.toFixed(6)}, Lng: ${userLng.toFixed(6)}`);
      },
      (error) => {
        setGpsSyncStatus('error');
        let errMsg = error.message;
        if (error.code === 1) {
          errMsg = "Access Refused. Try clicking 'Open in separate tab' at the top-right to bypass iframe restrictions!";
        } else if (error.code === 2) {
          errMsg = "Position unavailable. Device could not acquire GPS lock.";
        } else if (error.code === 3) {
          errMsg = "Connection timeout occurred during GPS lookup.";
        }
        setGpsSyncError(errMsg);
        addNewLogEntry(FlightState.IDLE, `GPS LOCK FAILED: ${errMsg}`);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  // Run initial pathing calculations and sync geolocation on boot
  useEffect(() => {
    syncLaptopLocation();
  }, []);

  // Run initial pathing calculations automatically when coordinates or hazards update
  useEffect(() => {
    if (startLoc && destLoc) {
      calculateFlightPath();
    }
  }, [startLoc, destLoc, obstacles]);

  // Main simulation tick hook (runs when drone is EN_ROUTE or EMERGENCY_LANDING)
  useEffect(() => {
    if (flightState === FlightState.EN_ROUTE || flightState === FlightState.EMERGENCY_LANDING) {
      mainTickerInterval.current = setInterval(() => {
        handleSimulationTick();
      }, 150); // High frequency responsiveness ticking
    } else {
      if (mainTickerInterval.current) {
        clearInterval(mainTickerInterval.current);
      }
    }

    return () => {
      if (mainTickerInterval.current) {
        clearInterval(mainTickerInterval.current);
      }
    };
  }, [flightState, currentPathIndex, plannedPath, battery, signal, climate, sensors, simulationWindSpeed]);

  // Stopwatch tracking effect: increments missionTimeSec every 1 second when active
  useEffect(() => {
    let stopwatchInterval: NodeJS.Timeout | null = null;
    if (flightState === FlightState.EN_ROUTE || flightState === FlightState.EMERGENCY_LANDING) {
      stopwatchInterval = setInterval(() => {
        setMissionTimeSec(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (stopwatchInterval) {
        clearInterval(stopwatchInterval);
      }
    };
  }, [flightState]);

  // Trigonometric bearing angle calculations
  const calculateHeading = (from: LatLng, to: LatLng) => {
    const dLat = to.lat - from.lat;
    const dLng = to.lng - from.lng;
    const angle = Math.atan2(dLng, dLat) * (180 / Math.PI);
    return (angle + 360) % 360;
  };

  // Evasive Path planning with obstacle clearances
  const calculateFlightPath = () => {
    const pointsCount = 60;
    const direct: LatLng[] = [];

    // 1. Build Straight path coordinates
    for (let i = 0; i <= pointsCount; i++) {
      const ratio = i / pointsCount;
      direct.push({
        lat: startLoc.lat + (destLoc!.lat - startLoc.lat) * ratio,
        lng: startLoc.lng + (destLoc!.lng - startLoc.lng) * ratio
      });
    }
    setDirectPath(direct);

    // 2. Identify obstacle intersections on direct line
    let blockingObs: Obstacle | null = null;
    let blockingIndex = -1;

    for (let i = 0; i < direct.length; i++) {
      const p = direct[i];
      for (const obs of obstacles) {
        const dLat = p.lat - obs.lat;
        const dLng = (p.lng - obs.lng) * Math.cos((p.lat * Math.PI) / 180);
        const distM = Math.sqrt(dLat * dLat + dLng * dLng) * degToMeter;
        if (distM < obs.radiusMeters) {
          blockingObs = obs;
          blockingIndex = i;
          break;
        }
      }
      if (blockingObs) break;
    }

    const detoured: LatLng[] = [];

    if (blockingObs) {
      // Find orthogonal angle displacement for collision dodge
      const obs = blockingObs;
      const vLat = destLoc!.lat - startLoc.lat;
      const vLng = destLoc!.lng - startLoc.lng;

      // Normal vector representation
      const nLat = -vLng;
      const nLng = vLat;
      const len = Math.sqrt(nLat * nLat + nLng * nLng);
      const uLat = nLat / len;
      const uLng = nLng / len;

      // Push detour node out of bounds with a clearance radius (Obstacle + 20m)
      const safetyRadDeg = (obs.radiusMeters + 22) / degToMeter;

      const entryRatio = Math.max(0.12, (blockingIndex - 10) / pointsCount);
      const entryPoint = {
        lat: startLoc.lat + (destLoc!.lat - startLoc.lat) * entryRatio,
        lng: startLoc.lng + (destLoc!.lng - startLoc.lng) * entryRatio
      };

      const detourPeak = {
        lat: obs.lat + uLat * safetyRadDeg,
        lng: obs.lng + uLng * safetyRadDeg / Math.cos((obs.lat * Math.PI) / 180)
      };

      const exitRatio = Math.min(0.88, (blockingIndex + 10) / pointsCount);
      const exitPoint = {
        lat: startLoc.lat + (destLoc!.lat - startLoc.lat) * exitRatio,
        lng: startLoc.lng + (destLoc!.lng - startLoc.lng) * exitRatio
      };

      // Form spline-like trajectory
      // segment 1: Base to Entry
      for (let i = 0; i < 15; i++) {
        const r = i / 15;
        detoured.push({
          lat: startLoc.lat + (entryPoint.lat - startLoc.lat) * r,
          lng: startLoc.lng + (entryPoint.lng - startLoc.lng) * r
        });
      }
      // segment 2: Entry to Detour apex
      for (let i = 0; i < 15; i++) {
        const r = i / 15;
        detoured.push({
          lat: entryPoint.lat + (detourPeak.lat - entryPoint.lat) * r,
          lng: entryPoint.lng + (detourPeak.lng - entryPoint.lng) * r
        });
      }
      // segment 3: Detour apex to Exit
      for (let i = 0; i < 15; i++) {
        const r = i / 15;
        detoured.push({
          lat: detourPeak.lat + (exitPoint.lat - detourPeak.lat) * r,
          lng: detourPeak.lng + (exitPoint.lng - detourPeak.lng) * r
        });
      }
      // segment 4: Exit to Dest
      for (let i = 0; i <= 15; i++) {
        const r = i / 15;
        detoured.push({
          lat: exitPoint.lat + (destLoc!.lat - exitPoint.lat) * r,
          lng: exitPoint.lng + (destLoc!.lng - exitPoint.lng) * r
        });
      }
    } else {
      detoured.push(...direct);
    }

    setPlannedPath(detoured);
    setFlightState(FlightState.PLANNING);
    setCurrentPathIndex(0);
    setDronePos({ lat: startLoc.lat, lng: startLoc.lng, heading: calculateHeading(startLoc, detoured[1] || startLoc) });
    return detoured;
  };

  // Launch Active Mission
  const startMission = () => {
    let path = plannedPath;
    if (path.length === 0 && startLoc && destLoc) {
      path = calculateFlightPath();
    }
    if (path.length > 0) {
      setFlightState(FlightState.EN_ROUTE);
      addNewLogEntry(FlightState.EN_ROUTE, "UAV coordinates initialization. Mission Launched.");
    }
  };

  // Force Emergency Landing Actions
  const triggerEmergencyOverride = () => {
    setFlightState(FlightState.EMERGENCY_LANDING);
    addNewLogEntry(FlightState.EMERGENCY_LANDING, "CRITICAL OVERRIDE: REMOTE EMERGENCY DESCENT BROADCASTED!");
  };

  // Reset/Charge System
  const resetSystem = () => {
    setDronePos({ lat: startLoc.lat, lng: startLoc.lng, heading: 0 });
    setFlightState(FlightState.IDLE);
    setPlannedPath([]);
    setDirectPath([]);
    setCurrentPathIndex(0);
    setBattery({
      percentage: 100,
      voltage: 16.8,
      cellVoltages: [4.20, 4.20, 4.20, 4.20],
      temperatureCelsius: 24.5,
      healthPercent: 98.6,
      dischargeRateAmps: 0.15
    });
    setClimate({
      ambientTempC: 18.2,
      batteryTempC: 24.5,
      heaterActive: false,
      coolerActive: false,
      windSpeedKnots: simulationWindSpeed,
      windDirectionDegrees: 140,
      airDensityKgM3: 1.204,
      thermalThrottling: false
    });
    setSensors({
      pitch: 0,
      roll: 0,
      yaw: 0,
      gpsAccuracyMothers: 0.02,
      barometerAltitudeM: 0.0,
      lidarDistanceM: 50.0,
      obstacleAvoidanceActive: false,
      obstacleType: null
    });
    setLogs([]);
    setMissionTimeSec(0);
  };

  // Climate Actuators Actions
  const toggleHeater = () => {
    setClimate(prev => ({ ...prev, heaterActive: !prev.heaterActive, coolerActive: false }));
  };

  const toggleCooler = () => {
    setClimate(prev => ({ ...prev, coolerActive: !prev.coolerActive, heaterActive: false }));
  };

  // Handle simulations iteration steps
  const handleSimulationTick = () => {
    // 1. Handle Active flight progress
    if (flightState === FlightState.EN_ROUTE) {
      if (currentPathIndex < plannedPath.length - 1) {
        const nextIndex = currentPathIndex + 1;
        setCurrentPathIndex(nextIndex);
        
        const currentCoord = plannedPath[currentPathIndex];
        const nextCoord = plannedPath[nextIndex];
        
        // Calculate dynamic tilt & aerodynamic pitch/roll compensation metrics under wind
        const windX = Math.cos((climate.windDirectionDegrees * Math.PI) / 180) * simulationWindSpeed;
        const windY = Math.sin((climate.windDirectionDegrees * Math.PI) / 180) * simulationWindSpeed;
        
        // UAV moves forward, creating slight forward pitch
        const compPitch = 5.4 + (windY * 0.12) + (Math.random() * 0.4 - 0.2);
        const compRoll = (windX * 0.15) + (Math.random() * 0.3 - 0.15);
        const headingVal = calculateHeading(currentCoord, nextCoord);

        // Slow ascent to flight altitude
        const targetAlt = Math.min(45, nextIndex * 1.5);

        // Distance to start (determines signaling index drops)
        const dLatStart = nextCoord.lat - startLoc.lat;
        const dLngStart = nextCoord.lng - startLoc.lng;
        const distStartM = Math.sqrt(dLatStart * dLatStart + dLngStart * dLngStart) * degToMeter;
        
        // Signal strength worsens as distance increases
        const strengthDbmVal = Math.max(-95, -45 - Math.round(distStartM * 0.06));
        const qualityVal = Math.max(10, Math.round(100 - (distStartM * 0.08)));

        // Core battery drainage
        // Higher wind speed increases rotor power consumption (discharge rate)
        const dischargeVal = 0.2 + (simulationWindSpeed * 0.035) + (climate.coolerActive ? 0.05 : 0);
        const batteryPctVal = Math.max(0, battery.percentage - (dischargeVal * 0.22));
        const cellVal = batteryPctVal * 4.2 / 100;

        // Battery Temperature models
        let tempVal = climate.batteryTempC;
        if (climate.heaterActive) {
          tempVal += 0.35;
        } else if (climate.coolerActive) {
          tempVal -= 0.45;
        } else {
          // Standard core engine heat offset equilibrium coefficient
          tempVal += (climate.ambientTempC + (dischargeVal * 5) - tempVal) * 0.05;
        }

        // Distance & scan LIDAR fields to detect obstacle presence
        let lidarDist = 50.0;
        let avoided = false;
        let matchedObsType: string | null = null;

        for (const obs of obstacles) {
          const dLatObs = nextCoord.lat - obs.lat;
          const dLngObs = (nextCoord.lng - obs.lng) * Math.cos((obs.lat * Math.PI) / 180);
          const distObsM = Math.sqrt(dLatObs * dLatObs + dLngObs * dLngObs) * degToMeter;
          
          if (distObsM < obs.radiusMeters + 25) {
            lidarDist = Math.max(2.5, distObsM - obs.radiusMeters);
            avoided = true;
            matchedObsType = obs.type;
          }
        }

        setDronePos({ lat: nextCoord.lat, lng: nextCoord.lng, heading: headingVal });
        setBattery(prev => ({
          ...prev,
          percentage: batteryPctVal,
          voltage: batteryPctVal * 16.8 / 100,
          cellVoltages: [cellVal, cellVal, cellVal, cellVal],
          dischargeRateAmps: dischargeVal
        }));
        setSignal(prev => ({
          ...prev,
          strengthDbm: strengthDbmVal,
          qualityPercent: qualityVal
        }));
        setClimate(prev => ({
          ...prev,
          batteryTempC: tempVal,
          thermalThrottling: tempVal > 43
        }));
        setSensors(prev => ({
          ...prev,
          pitch: compPitch,
          roll: compRoll,
          yaw: headingVal,
          barometerAltitudeM: targetAlt,
          lidarDistanceM: lidarDist,
          obstacleAvoidanceActive: avoided,
          obstacleType: matchedObsType
        }));

        // Ingest telemetry logs at 1Hz rate frequency
        logTickerDivider.current += 1;
        if (logTickerDivider.current >= 6) {
          logTickerDivider.current = 0;
          addNewLogEntry(FlightState.EN_ROUTE, "Telemetry continuous stream frame ingestion OK.");
        }
      } else {
        // Destination fully reached!
        setFlightState(FlightState.LANDED_SAFE);
        setSensors(prev => ({ ...prev, pitch: 0, roll: 0, barometerAltitudeM: 0 }));
        addNewLogEntry(FlightState.LANDED_SAFE, "SUCCESS: Delivery point reached as planned. Motors powered down.");
      }
    }

    // 2. Handle Emergency override landing descent simulation
    if (flightState === FlightState.EMERGENCY_LANDING) {
      if (sensors.barometerAltitudeM > 0) {
        const nextAlt = Math.max(0, sensors.barometerAltitudeM - 1.8);
        const thermalVal = climate.batteryTempC + (climate.ambientTempC - climate.batteryTempC) * 0.1;
        
        setSensors(prev => ({
          ...prev,
          barometerAltitudeM: nextAlt,
          pitch: prev.pitch * 0.7, // auto-stabilizing level orientation
          roll: prev.roll * 0.7,
          lidarDistanceM: Math.min(50, nextAlt)
        }));
        setClimate(prev => ({ ...prev, batteryTempC: thermalVal }));

        logTickerDivider.current += 1;
        if (logTickerDivider.current >= 6) {
          logTickerDivider.current = 0;
          addNewLogEntry(FlightState.EMERGENCY_LANDING, "CRITICAL EMER INGEST: Active forced descent monitoring.");
        }
      } else {
        setFlightState(FlightState.LANDED_SAFE);
        addNewLogEntry(FlightState.LANDED_SAFE, "OVERRIDE COMPLETE: Safe landing coordinate registered.");
      }
    }
  };

  // Format elapsed time to MM:SS format helper
  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Compile individual clean REST standard frames
  const addNewLogEntry = (state: FlightState, detail: string) => {
    const formattedDur = missionTimeSec > 0 ? formatDuration(missionTimeSec) : undefined;
    const finalDetail = formattedDur ? `${detail} (Elapsed Flight duration: ${formattedDur})` : detail;
    const frame: TelemetryLog = {
      id: `UAV-COOPS-${Date.now().toString().slice(-5)}`,
      timestamp: new Date().toISOString(),
      flightState: state,
      latitude: dronePos.lat,
      longitude: dronePos.lng,
      altitudeMeters: sensors.barometerAltitudeM,
      headingDegrees: dronePos.heading,
      batteryPercentage: battery.percentage,
      batteryTempCelsius: climate.batteryTempC,
      signalStrengthDbm: signal.strengthDbm,
      encryptionActive: signal.isEncrypted,
      pitchDegrees: sensors.pitch,
      rollDegrees: sensors.roll,
      yawDegrees: dronePos.heading,
      lidarDistanceMeters: sensors.lidarDistanceM,
      obstacleAvoidanceActive: sensors.obstacleAvoidanceActive,
      emergencyLandingActive: state === FlightState.EMERGENCY_LANDING,
      ambientTemperatureCelsius: climate.ambientTempC,
      climateHeaterActive: climate.heaterActive,
      climateCoolerActive: climate.coolerActive,
      windSpeedKnots: simulationWindSpeed,
      flightDuration: formattedDur,
      detail: finalDetail
    };

    setLogs(prev => [...prev, frame]);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950 pb-14 relative overflow-hidden">
      
      {/* Background Map Layer (SVG Pattern) */}
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

      {/* Top Navigation Bar with glassmorphism */}
      <header className="border-b border-white/10 bg-slate-950/40 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-cyan-500 rounded flex items-center justify-center font-bold text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              UAV
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white uppercase font-display flex items-center">
                SkyNav Avionics Systems
                <span className="text-cyan-400 text-[9px] font-mono ml-2 bg-white/5 px-2 py-0.5 rounded border border-white/10">v4.2.0-STABLE</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono">Autonomous Drone Mission Control, LiDAR Collision Avoidance & Spring Boot Data Exporter</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3.5">
            <span className="text-[10px] font-mono shrink-0 px-2.5 py-1 bg-white/5 border border-white/10 text-cyan-400 rounded-full flex items-center backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              PORTAL SECURE
            </span>
          </div>
        </div>
      </header>

      {/* Main Structural Layout Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-7 relative z-10">

        {/* Tactical Map and Flight Panel Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main Visual Map Pane with Telemetry Log Stream directly below */}
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
            <TelemetryLogStream
              logs={logs}
              onClearLogs={() => setLogs([])}
            />
          </div>

          {/* Mission Control Panel Controls with Telemetry Insights directly below */}
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
            />
            <TelemetryInsights
              logs={logs}
            />
          </div>

        </section>

        {/* Real-time Simulated Optical & Thermal Gimbal Feeds */}
        <section>
          <CameraFeed
            dronePos={dronePos}
            flightState={flightState}
            destLoc={destLoc}
            obstacles={obstacles}
            sensors={sensors}
          />
        </section>

        {/* Meteorological and Dynamic Actuators Readouts */}
        <section>
          <SensorReadout
            sensors={sensors}
            climate={climate}
            signal={signal}
            speedKmh={flightState === FlightState.EN_ROUTE ? (32.4 + (Math.sin(Date.now() * 0.005) * 1.5)) : 0}
            altitudeM={sensors.barometerAltitudeM}
            onToggleHeater={toggleHeater}
            onToggleCooler={toggleCooler}
            onSetEncryptionKey={(k) => setSignal(p => ({ ...p, encryptionKey: k, isEncrypted: k !== '' }))}
            onSimulateObstacleAlert={() => {
              setSensors(prev => ({
                ...prev,
                lidarDistanceM: 8.5,
                obstacleAvoidanceActive: true,
                obstacleType: "Dynamic Substation Flare"
              }));
              addNewLogEntry(FlightState.EN_ROUTE, "LIDAR SCAN ALERT: Unmapped sensor hazard detected in trajectory!");
            }}
            simulationWindSpeed={simulationWindSpeed}
            onChangeWindSpeed={(v) => setSimulationWindSpeed(v)}
          />
        </section>





      </main>
    </div>
  );
}

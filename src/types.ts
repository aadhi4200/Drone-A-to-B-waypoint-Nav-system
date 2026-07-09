export enum FlightState {
  IDLE = "IDLE",
  PLANNING = "PLANNING",
  EN_ROUTE = "EN_ROUTE",
  EMERGENCY_LANDING = "EMERGENCY_LANDING",
  LANDED_SAFE = "LANDED_SAFE",
  CRITICAL_ALERT = "CRITICAL_ALERT"
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DroneLocation extends LatLng {
  alt: number;
  heading: number;
}

export interface BatteryState {
  percentage: number;
  voltage: number; // overall voltage
  cellVoltages: number[]; // e.g. 4S battery
  temperatureCelsius: number;
  healthPercent: number;
  dischargeRateAmps: number;
}

export interface SignalState {
  strengthDbm: number; // e.g. -45 to -100
  qualityPercent: number;
  encryptionKey: string;
  isEncrypted: boolean;
  protocol: string; // "AES-256-GCM" or "UNSECURED"
}

export interface ClimateState {
  ambientTempC: number;
  batteryTempC: number;
  heaterActive: boolean;
  coolerActive: boolean;
  windSpeedKnots: number;
  windDirectionDegrees: number;
  airDensityKgM3: number;
  thermalThrottling: boolean;
}

export interface SensorOrientation {
  pitch: number; // degrees
  roll: number;  // degrees
  yaw: number;   // degrees
  gpsAccuracyMothers: number;
  barometerAltitudeM: number;
  lidarDistanceM: number;
  obstacleAvoidanceActive: boolean;
  obstacleType: string | null;
}

export interface TelemetryLog {
  id: string; // UUID/String
  timestamp: string; // ISO 8601
  flightState: FlightState;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  headingDegrees: number;
  batteryPercentage: number;
  batteryTempCelsius: number;
  signalStrengthDbm: number;
  encryptionActive: boolean;
  pitchDegrees: number;
  rollDegrees: number;
  yawDegrees: number;
  lidarDistanceMeters: number;
  obstacleAvoidanceActive: boolean;
  emergencyLandingActive: boolean;
  ambientTemperatureCelsius: number;
  climateHeaterActive: boolean;
  climateCoolerActive: boolean;
  windSpeedKnots: number;
  flightDuration?: string;
  detail?: string;
}

export interface Obstacle {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  heightMeters: number;
  type: string;
}

// ── Mission waypoints (multi-stop B/C/D..., Feature 1/2/5) ──────────────
export interface MissionWaypoint {
  label: string;
  lat: number;
  lng: number;
  alt: number;
  markerId?: number;
  markerStatus?: 'idle' | 'generating' | 'spawned' | 'error';
}

// ── WebSocket push messages (Feature 3/6/8/9) ────────────────────────────
export interface NodeStatusMessage {
  type: 'node_status';
  nodes: Record<string, 'CONNECTED' | 'DISCONNECTED'>;
  preflight: {
    gps_lock: boolean;
    satellites: number | null;
    battery_pct: number;
    mavros_connected: boolean;
    home_set: boolean;
    geofence_valid: boolean;
    home_position_match: boolean;
  };
  all_clear: boolean;
  reasons: string[];
}

export interface ImuMessage {
  type: 'imu';
  pitch: number;
  roll: number;
  yaw: number;
  rate: { x: number; y: number; z: number };
}

export interface PositionMessage {
  type: 'position';
  lat: number;
  lon: number;
  heading: number;
  altitude: number;
}

export type SystemStatusMessage = NodeStatusMessage | ImuMessage | PositionMessage;

// ── Hardware profile / range estimate (Feature 11) ───────────────────────
export interface DroneProfile {
  motor_kv?: number | null;
  esc_amp?: number | null;
  battery_mah?: number | null;
  cells?: number | null;
  num_motors?: number | null;
  auw_grams?: number | null;
  efficiency_factor?: number | null;
  cruise_speed_ms?: number | null;
}

export interface RangeEstimate {
  flight_time_min: number | null;
  range_m: number | null;
  nominal_voltage: number | null;
  hover_current_a: number | null;
  note: string;
}

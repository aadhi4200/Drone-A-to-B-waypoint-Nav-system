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

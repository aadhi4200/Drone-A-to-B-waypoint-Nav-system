// api.ts — talks to backend/main.py (FastAPI + ROS2 bridge, default http://localhost:8000)

export const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

export interface UploadWaypoint {
  lat: number;
  lon: number;
  alt?: number;
  label?: string;
}

export interface MissionStatus {
  mission_state: string;
  drone_status?: string;
  lat: number;
  lon: number;
  altitude: number;
  heading?: number;
  battery?: number;
  flight_mode?: string;
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function uploadWaypoints(waypoints: UploadWaypoint[]) {
  return post('/mission/upload', { waypoints });
}

export async function startMission() {
  return post('/mission/start');
}

export async function abortMission() {
  return post('/mission/abort');
}

export async function armDrone() {
  return post('/drone/arm');
}

export async function disarmDrone() {
  return post('/drone/disarm');
}

export async function getMissionStatus(): Promise<MissionStatus> {
  const res = await fetch(`${API_BASE}/mission/status`);
  if (!res.ok) throw new Error(`GET /mission/status failed: ${res.status}`);
  return res.json();
}

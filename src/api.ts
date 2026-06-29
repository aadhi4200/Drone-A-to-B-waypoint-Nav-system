// src/api.ts
// Bridge between React UI and FastAPI backend (ROS2)

const BASE_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";

export interface Waypoint {
  lat:   number;
  lon:   number;
  alt:   number;
  label: string;
}

// Upload waypoints → FastAPI → ROS2 /mission/waypoints topic
export async function uploadWaypoints(waypoints: Waypoint[]) {
  const res = await fetch(`${BASE_URL}/mission/upload`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ waypoints }),
  });
  if (!res.ok) throw new Error(`uploadWaypoints failed: ${res.status}`);
  return res.json();
}

// Send START → FastAPI → ROS2 /mission/command "START"
export async function startMission() {
  const res = await fetch(`${BASE_URL}/mission/start`, { method: "POST" });
  if (!res.ok) throw new Error(`startMission failed: ${res.status}`);
  return res.json();
}

// Send ABORT → FastAPI → ROS2 /mission/command "ABORT"
export async function abortMission() {
  const res = await fetch(`${BASE_URL}/mission/abort`, { method: "POST" });
  if (!res.ok) throw new Error(`abortMission failed: ${res.status}`);
  return res.json();
}

// Poll status ← FastAPI ← ROS2 /mission/status + /drone_base/status
export async function getMissionStatus(): Promise<{
  mission_state: string;
  drone_status:  string;
  lat?:          number;
  lon?:          number;
  altitude?:     number;
}> {
  const res = await fetch(`${BASE_URL}/mission/status`);
  if (!res.ok) throw new Error(`getMissionStatus failed: ${res.status}`);
  return res.json();
}

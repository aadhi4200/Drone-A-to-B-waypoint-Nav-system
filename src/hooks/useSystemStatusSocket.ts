import { useEffect, useRef, useState } from 'react';
import { WS_BASE } from '../api';
import { NodeStatusMessage, ImuMessage, PositionMessage, MissionStateMessage } from '../types';

// Plain WebSocket (no library needed) with reconnect-with-backoff. Losing
// this socket must never affect the drone — it only drives the dashboard,
// which is monitoring-only by design (see Feature 9/backend connectivity
// gate: the *authoritative* safety checks are enforced server-side).
export function useSystemStatusSocket() {
  const [connected, setConnected] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<NodeStatusMessage | null>(null);
  const [imu, setImu] = useState<ImuMessage | null>(null);
  const [position, setPosition] = useState<PositionMessage | null>(null);
  const [missionState, setMissionState] = useState<MissionStateMessage | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(`${WS_BASE}/ws/system-status`);

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'node_status') setNodeStatus(msg as NodeStatusMessage);
          else if (msg.type === 'imu') setImu(msg as ImuMessage);
          else if (msg.type === 'position') setPosition(msg as PositionMessage);
          else if (msg.type === 'mission_state') setMissionState(msg as MissionStateMessage);
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        retryTimeout = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      ws?.close();
    };
  }, []);

  return { connected, nodeStatus, imu, position, missionState };
}

import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { NodeStatusMessage } from '../types';

interface ConnectivityBannerProps {
  nodeStatus: NodeStatusMessage | null;
  wsConnected: boolean;
}

const REASON_LABELS: Record<string, string> = {
  mavros_connected: 'MAVROS not connected to PX4',
  nodes_alive: 'One or more ROS2 nodes not responding',
  gps_lock: 'No GPS lock',
  home_set: 'Home position not set',
  battery_ok: 'Battery critically low',
  home_position_match: 'SITL home does not match synced location',
  geofence_valid: 'A waypoint is outside the geofence',
};

function describeReason(reason: string): string {
  if (reason.startsWith('stale_nodes:')) {
    return `Node(s) not reporting: ${reason.slice('stale_nodes:'.length)}`;
  }
  return REASON_LABELS[reason] || reason;
}

export default function ConnectivityBanner({ nodeStatus, wsConnected }: ConnectivityBannerProps) {
  // One-time "link restored" flash: shown for a few seconds only when the
  // socket transitions from down back to up, then falls through to the
  // normal status banners.
  const wasDownRef = useRef(false);
  const [justReconnected, setJustReconnected] = useState(false);
  useEffect(() => {
    if (!wsConnected) {
      wasDownRef.current = true;
      setJustReconnected(false);
    } else if (wasDownRef.current) {
      wasDownRef.current = false;
      setJustReconnected(true);
      const t = setTimeout(() => setJustReconnected(false), 4000);
      return () => clearTimeout(t);
    }
  }, [wsConnected]);

  if (!wsConnected) {
    return (
      <div className="relative overflow-hidden p-3 bg-[#141417]/60 border border-white/10 rounded-xl text-[#9a9aa2] text-[10.5px] font-mono flex items-center gap-2">
        <div
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none"
          style={{ animation: 'banner-shimmer 2.4s linear infinite' }}
        />
        <ShieldAlert className="w-4 h-4 shrink-0 text-[#7c7c84] animate-pulse" />
        <span>
          Dashboard link down — monitoring only, this does not affect the drone. Reconnecting
          <span className="reconnect-dots"><span>.</span><span>.</span><span>.</span></span>
        </span>
      </div>
    );
  }

  if (justReconnected) {
    return (
      <div
        className="p-3 bg-emerald-950/30 border border-emerald-500/40 rounded-xl text-emerald-300 text-[10.5px] font-mono flex items-center gap-2 uppercase font-bold"
        style={{ animation: 'banner-pop 0.45s ease-out, banner-glow-fade 2.8s ease-out forwards' }}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" style={{ animation: 'check-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
        Dashboard link restored — live telemetry resumed
      </div>
    );
  }

  if (!nodeStatus) {
    return (
      <div className="p-3 bg-[#141417]/60 border border-white/10 rounded-xl text-[#9a9aa2] text-[10.5px] font-mono flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 text-[#7c7c84] animate-pulse" />
        Waiting for connectivity status...
      </div>
    );
  }

  if (nodeStatus.all_clear) {
    return (
      <div className="p-3 bg-emerald-950/20 border border-emerald-600/30 rounded-xl text-emerald-400 text-[10.5px] font-mono flex items-center gap-2 uppercase font-bold">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        All systems connected — ready to arm/start
      </div>
    );
  }

  return (
    <div className="p-3 bg-red-950/20 border border-red-600/30 rounded-xl text-red-400 text-[10px] font-mono uppercase font-bold">
      <div className="flex items-center gap-2 mb-1.5">
        <ShieldAlert className="w-4 h-4 shrink-0 animate-pulse" />
        Not ready — mission controls locked
      </div>
      <ul className="space-y-0.5 pl-6 list-disc normal-case font-normal text-red-300">
        {nodeStatus.reasons.map(r => <li key={r}>{describeReason(r)}</li>)}
      </ul>
    </div>
  );
}

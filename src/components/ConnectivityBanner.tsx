import React from 'react';
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
  if (!wsConnected) {
    return (
      <div className="p-3 bg-[#141417]/60 border border-white/10 rounded-xl text-[#9a9aa2] text-[10.5px] font-mono flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 text-[#7c7c84]" />
        Dashboard link down — monitoring only, this does not affect the drone. Reconnecting...
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

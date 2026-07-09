import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: React.ReactNode }
interface State { hasError: boolean }

// A map-engine failure (no WebGL, tile host unreachable, etc.) must not take
// down the rest of the mission-control dashboard — arm/abort/telemetry are
// far more important than the map rendering.
export default class MapErrorBoundary extends React.Component<Props, State> {
  // This project has no @types/react installed, so the inherited
  // props/state fields aren't visible to the checker — redeclare them
  // explicitly (assigned for real by React.Component's actual runtime code).
  props!: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('MapPane failed to render:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center justify-center h-[520px] text-center p-6">
          <AlertTriangle className="w-8 h-8 text-amber-400 mb-3" />
          <p className="text-sm text-white font-semibold">Map engine failed to initialize</p>
          <p className="text-[11px] text-slate-400 font-mono mt-1">
            (No WebGL context available in this environment.) Mission control below is unaffected.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

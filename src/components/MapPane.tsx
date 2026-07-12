import React, { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Navigation, ShieldAlert, CheckCircle, Crosshair, AlertCircle, RefreshCw, Search, MapPin, Loader2, Layers } from 'lucide-react';
import { LatLng, Obstacle, FlightState, MissionWaypoint } from '../types';

interface MapPaneProps {
  apiKey: string;
  hasValidKey: boolean;
  startLoc: LatLng;
  destLoc: LatLng | null;
  dronePos: { lat: number; lng: number; heading: number };
  obstacles: Obstacle[];
  flightState: FlightState;
  onSetStartLoc: (loc: LatLng) => void;
  onSetDestLoc: (loc: LatLng | null) => void;
  onAddWaypoint?: (loc: LatLng) => void;
  waypoints?: MissionWaypoint[];
  traveledPath?: LatLng[];
  plannedPath: LatLng[];
  directPath: LatLng[];
  avoidanceActive: boolean;
  emergencyLandingActive: boolean;
  // QGC-style geofence: committed polygon, in-progress draft, and handlers
  geofence?: LatLng[];
  fenceDraft?: LatLng[];
  onFenceVertex?: (loc: LatLng) => void;
  onFinishFence?: () => void;
  onClearFence?: () => void;
}

// Coordinate outline calculations mapping helper
function createGeoJSONCircle(center: [number, number], radiusInMeters: number, properties: any = {}, points: number = 64) {
  const coords = [];
  // Calculate latitude and longitude scaling for spherical rendering accurately
  const distanceX = radiusInMeters / (111320 * Math.cos((center[1] * Math.PI) / 180));
  const distanceY = radiusInMeters / 110540;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([center[0] + x, center[1] + y]);
  }
  coords.push(coords[0]); // Complete loop

  return {
    type: 'Feature' as const,
    properties: properties,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coords],
    },
  };
}

const CARTO_VECTOR_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function MapPane({
  apiKey,
  hasValidKey,
  startLoc,
  destLoc,
  dronePos,
  obstacles,
  flightState,
  onSetStartLoc,
  onSetDestLoc,
  onAddWaypoint,
  waypoints = [],
  traveledPath = [],
  plannedPath,
  directPath,
  avoidanceActive,
  emergencyLandingActive,
  geofence = [],
  fenceDraft = [],
  onFenceVertex,
  onFinishFence,
  onClearFence
}: MapPaneProps) {
  const [activeTab, setActiveTab ] = useState<'simulation' | 'leaflet'>('leaflet');
  const [clickMode, setClickMode] = useState<'start' | 'dest' | 'fence'>('dest');
  const [is3DMode, setIs3DMode] = useState(true);

  // Handle 3D mode toggling
  const toggle3DMode = () => {
    const nextMode = !is3DMode;
    setIs3DMode(nextMode);
    if (mapRef.current) {
      mapRef.current.easeTo({
        pitch: nextMode ? 55 : 0,
        bearing: nextMode ? -15 : 0,
        duration: 1200
      });
    }
  };

  // Destination Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    setShowDropdown(true);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`
      );
      if (!response.ok) {
        throw new Error('Search failed');
      }
      const data = await response.json();
      setSearchResults(data);
      if (data.length === 0) {
        setSearchError('No locations found');
      }
    } catch (err: any) {
      setSearchError('Failed to geocode location');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectLocation = (loc: any) => {
    const lat = parseFloat(loc.lat);
    const lng = parseFloat(loc.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      const roundedCoord = {
        lat: Math.round(lat * 1000000) / 1000000,
        lng: Math.round(lng * 1000000) / 1000000
      };
      if (clickMode === 'start') {
        onSetStartLoc(roundedCoord);
      } else {
        onSetDestLoc(roundedCoord);
      }
      setSearchQuery(loc.display_name);
      setShowDropdown(false);
      
      // Pan MapLibre map smoothly
      if (mapRef.current) {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 15 });
      }
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const droneMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Direct reference to the rotating inner icon node, captured once at
  // creation time -- avoids re-querying '#maplibre-drone-wrapper > div:last-child'
  // via the DOM on every update, which is fragile (depends on exact child
  // ordering never changing) and was the leading suspect for the marker's
  // rotation appearing frozen.
  const droneRotateNodeRef = useRef<HTMLElement | null>(null);
  const obstacleMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Smooth drone-marker movement (Feature 8/9): lerp toward each new position
  // over a short window instead of snapping, the way ride-tracking UIs
  // animate between GPS pings.
  const droneRenderPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const droneAnimFrameRef = useRef<number | null>(null);
  const animateDroneTo = (target: { lat: number; lng: number }) => {
    const marker = droneMarkerRef.current;
    if (!marker) return;
    const start = droneRenderPosRef.current ?? target;
    const startTime = performance.now();
    const duration = 400;
    if (droneAnimFrameRef.current !== null) cancelAnimationFrame(droneAnimFrameRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const lat = start.lat + (target.lat - start.lat) * t;
      const lng = start.lng + (target.lng - start.lng) * t;
      droneRenderPosRef.current = { lat, lng };
      marker.setLngLat([lng, lat]);
      if (t < 1) {
        droneAnimFrameRef.current = requestAnimationFrame(step);
      } else {
        droneAnimFrameRef.current = null;
      }
    };
    droneAnimFrameRef.current = requestAnimationFrame(step);
  };

  const clickModeRef = useRef(clickMode);
  useEffect(() => {
    clickModeRef.current = clickMode;
  }, [clickMode]);

  const onAddWaypointRef = useRef(onAddWaypoint);
  useEffect(() => {
    onAddWaypointRef.current = onAddWaypoint;
  }, [onAddWaypoint]);

  const onFenceVertexRef = useRef(onFenceVertex);
  useEffect(() => {
    onFenceVertexRef.current = onFenceVertex;
  }, [onFenceVertex]);

  const [mapLoaded, setMapLoaded] = useState(false);

  // MapLibre Map Initialization
  useEffect(() => {
    if (!containerRef.current) return;

    // Create the MapLibre map instance with 3D default angles (uses [longitude, latitude])
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_VECTOR_DARK_STYLE,
      center: [startLoc.lng, startLoc.lat],
      zoom: 14.5,
      pitch: 55,       // High-fidelity 3D tilt
      bearing: -15,    // Slanted tactical rotation
      attributionControl: false
    });

    mapRef.current = map;

    // Handle map clicks
    map.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      const roundedCoord = {
        lat: Math.round(lat * 1000000) / 1000000,
        lng: Math.round(lng * 1000000) / 1000000
      };
      if (clickModeRef.current === 'fence') {
        onFenceVertexRef.current?.(roundedCoord);
      } else if (clickModeRef.current === 'start') {
        onSetStartLoc(roundedCoord);
      } else {
        onSetDestLoc(roundedCoord);
        onAddWaypointRef.current?.(roundedCoord);
      }
    });

    // Populate lines/fills layers on style load
    map.on('load', () => {
      setMapLoaded(true);

      // Add sources
      map.addSource('direct-path', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'direct-path-layer',
        type: 'line',
        source: 'direct-path',
        paint: {
          'line-color': '#d97706',
          'line-width': 1.5,
          'line-dasharray': [3, 2]
        }
      });

      map.addSource('planned-path', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'planned-path-layer',
        type: 'line',
        source: 'planned-path',
        paint: {
          'line-color': '#06b6d4',
          'line-width': 2.5,
          'line-opacity': 0.5,
          'line-dasharray': [2, 2]
        }
      });

      // Uber/Google-Directions-style "traveled so far" trail — solid, distinct
      // from the lighter/dashed planned-path-layer above (Feature 8/9).
      map.addSource('traveled-path', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'traveled-path-layer',
        type: 'line',
        source: 'traveled-path',
        paint: {
          'line-color': '#22d3ee',
          'line-width': 3.5
        }
      });

      // QGC-style geofence polygon: amber fill + solid outline for the
      // committed fence, dashed line + vertex dots while drawing a draft.
      map.addSource('geofence', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'geofence-fill',
        type: 'fill',
        source: 'geofence',
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.07 }
      });
      map.addLayer({
        id: 'geofence-outline',
        type: 'line',
        source: 'geofence',
        paint: { 'line-color': '#f59e0b', 'line-width': 2.5 }
      });
      map.addSource('geofence-draft', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'geofence-draft-line',
        type: 'line',
        source: 'geofence-draft',
        paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [2, 2] }
      });
      map.addLayer({
        id: 'geofence-draft-points',
        type: 'circle',
        source: 'geofence-draft',
        paint: { 'circle-radius': 4.5, 'circle-color': '#f59e0b', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 1.5 }
      });

      map.addSource('obstacles-path', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Flat base layout for 3D cylinders
      map.addLayer({
        id: 'obstacles-hazard-layer',
        type: 'fill',
        source: 'obstacles-path',
        paint: {
          'fill-color': '#f43f5e',
          'fill-opacity': 0.12
        }
      });
      map.addLayer({
        id: 'obstacles-outline-layer',
        type: 'line',
        source: 'obstacles-path',
        paint: {
          'line-color': '#f43f5e',
          'line-width': 1.5,
          'line-dasharray': [4, 4]
        }
      });

      // 3D obstacle columns (extruded hazard columns)
      map.addLayer({
        id: 'obstacles-hazard-3d',
        type: 'fill-extrusion',
        source: 'obstacles-path',
        paint: {
          'fill-extrusion-color': '#f43f5e',
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 30],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.50
        }
      });

      // Extract details dynamically to inject gorgeous vector-level 3D skyscrapers
      try {
        const style = map.getStyle();
        let vectorSourceId = '';
        if (style && style.sources) {
          for (const id of Object.keys(style.sources)) {
            if (style.sources[id].type === 'vector') {
              vectorSourceId = id;
              break;
            }
          }
        }

        if (vectorSourceId) {
          map.addLayer({
            id: 'v-3d-buildings',
            type: 'fill-extrusion',
            source: vectorSourceId,
            'source-layer': 'building',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0, '#0f172a',
                30, '#111827',
                70, '#1e1b4b',
                150, '#1e3a8a'
              ],
              'fill-extrusion-height': [
                'coalesce',
                ['get', 'height'],
                ['get', 'render_height'],
                18
              ],
              'fill-extrusion-base': [
                'coalesce',
                ['get', 'min_height'],
                ['get', 'render_min_height'],
                0
              ],
              'fill-extrusion-opacity': 0.65
            }
          });
        }
      } catch (err) {
        console.warn('Could not inject 3D vector-building structures:', err);
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      startMarkerRef.current = null;
      destMarkerRef.current = null;
      droneMarkerRef.current = null;
      droneRotateNodeRef.current = null;
      obstacleMarkersRef.current.forEach(m => m.remove());
      obstacleMarkersRef.current = [];
      waypointMarkersRef.current.forEach(m => m.remove());
      waypointMarkersRef.current = [];
      if (droneAnimFrameRef.current !== null) cancelAnimationFrame(droneAnimFrameRef.current);
      setMapLoaded(false);
    };
  }, []);

  // Sync state changes & real-time markers to MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Start marker -- removed from view per operator request (the drone
    // arrow marker was being confused with it). startLoc itself is kept as
    // state (still drives map centering below and distance calculations
    // elsewhere) -- only its visual marker is gone. Clean up any marker a
    // stale render already created so nothing lingers on a hot-reload.
    if (startMarkerRef.current) {
      startMarkerRef.current.remove();
      startMarkerRef.current = null;
    }

    // (IDLE recentering moved to its own effect below -- it used to live
    // here, but this effect re-runs on EVERY dronePos tick, so the camera
    // was being re-panned toward startLoc many times per second. That
    // continuous easing fought all manual pan/zoom and, on the pitched 3D
    // view, read as the arrow marker steadily sliding away -- confirmed
    // live 2026-07-11 with telemetry proven stationary at the time.)

    // 2. Sync destination marker
    if (destLoc) {
      if (!destMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'custom-dest-icon';
        el.innerHTML = `
          <div class="relative flex items-center justify-center w-8 h-8 rounded-full bg-slate-950/80 border border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] text-emerald-400 font-bold">
            <svg class="w-4 h-4 animate-pulse duration-1000" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
        `;
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([destLoc.lng, destLoc.lat])
          .addTo(map);
        destMarkerRef.current = marker;
      } else {
        destMarkerRef.current.setLngLat([destLoc.lng, destLoc.lat]);
      }
    } else {
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
    }

    // 3. Sync Drone position & heading overlay
    // Guard against an orphaned marker: if a previous marker's element is no
    // longer actually attached to the document (can happen if this effect
    // re-ran without MapLibre's own element being torn down first), treat it
    // as gone and rebuild cleanly rather than trying to update a detached,
    // frozen-in-place node -- confirmed live 2026-07-11 as the drone icon
    // appearing to "float" at a fixed screen position unrelated to its real
    // map coordinate, with rotation stuck at whatever it was when orphaned.
    const droneMarkerIsLive = droneMarkerRef.current
      && document.body.contains(droneMarkerRef.current.getElement());
    if (!droneMarkerIsLive) {
      if (droneMarkerRef.current) {
        droneMarkerRef.current.remove();
        droneMarkerRef.current = null;
      }
      const el = document.createElement('div');
      el.className = 'custom-drone-icon';
      el.innerHTML = `
        <div id="maplibre-drone-wrapper" class="relative flex items-center justify-center h-10 w-10">
          <div class="absolute -inset-1 rounded-full border border-cyan-500/40 animate-ping"></div>
          <div class="relative flex items-center justify-center p-2 rounded-full bg-slate-950 border-2 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.6)] text-white font-bold h-10 w-10 origin-center transition-all" style="transform: rotate(${dronePos.heading}deg);">
            <svg class="w-5 h-5 text-cyan-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m12 2-7.5 19 7.5-3 7.5 3-7.5-19Z"/>
            </svg>
          </div>
        </div>
      `;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([dronePos.lng, dronePos.lat])
        .addTo(map);
      droneMarkerRef.current = marker;
      // Captured ONCE here, at creation time -- every subsequent rotation
      // update below reads this direct reference instead of re-querying the
      // DOM via a CSS selector on every render.
      droneRotateNodeRef.current = el.querySelector<HTMLElement>('#maplibre-drone-wrapper > div:last-child');
      droneRenderPosRef.current = { lat: dronePos.lat, lng: dronePos.lng };
    } else {
      animateDroneTo({ lat: dronePos.lat, lng: dronePos.lng });
      if (droneRotateNodeRef.current) {
        droneRotateNodeRef.current.style.transform = `rotate(${dronePos.heading}deg)`;
      }
    }

    // Auto center map tracking viewport as drone is active
    if (flightState === FlightState.EN_ROUTE) {
      map.setCenter([dronePos.lng, dronePos.lat]);
    }
  }, [startLoc, destLoc, dronePos, flightState]);

  // IDLE recentering — its own effect, keyed on the home COORDINATES (not
  // dronePos), so it fires once when home actually changes (mount
  // hydration, a fresh geolocation sync) instead of on every telemetry
  // tick. panTo alone preserves zoom, so if the camera is sitting at a
  // world-scale view (seen live 2026-07-11), also restore a usable
  // operating zoom; otherwise leave the operator's own zoom alone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (flightState !== FlightState.IDLE) return;
    if (map.getZoom() < 11) {
      map.flyTo({ center: [startLoc.lng, startLoc.lat], zoom: 14.5 });
    } else {
      map.panTo([startLoc.lng, startLoc.lat]);
    }
  }, [startLoc.lat, startLoc.lng, flightState]);

  // Sync paths & obstacles to vector layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Sync direct path
    const directSource = map.getSource('direct-path') as maplibregl.GeoJSONSource;
    if (directSource) {
      directSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: directPath.map(p => [p.lng, p.lat])
        }
      });
    }

    // Sync planned path
    const plannedSource = map.getSource('planned-path') as maplibregl.GeoJSONSource;
    if (plannedSource) {
      plannedSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: plannedPath.map(p => [p.lng, p.lat])
        }
      });
    }

    // Sync traveled trail (Feature 8/9)
    const traveledSource = map.getSource('traveled-path') as maplibregl.GeoJSONSource;
    if (traveledSource) {
      traveledSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: traveledPath.map(p => [p.lng, p.lat])
        }
      });
    }

    // Sync geofence polygon + draft (QGC-style)
    const geofenceSource = map.getSource('geofence') as maplibregl.GeoJSONSource;
    if (geofenceSource) {
      geofenceSource.setData({
        type: 'FeatureCollection',
        features: geofence.length >= 3 ? [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[...geofence.map(p => [p.lng, p.lat]), [geofence[0].lng, geofence[0].lat]]]
          }
        }] : []
      });
    }
    const fenceDraftSource = map.getSource('geofence-draft') as maplibregl.GeoJSONSource;
    if (fenceDraftSource) {
      const draftFeatures: any[] = fenceDraft.map(p => ({
        type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
      }));
      if (fenceDraft.length >= 2) {
        draftFeatures.push({
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: fenceDraft.map(p => [p.lng, p.lat]) }
        });
      }
      fenceDraftSource.setData({ type: 'FeatureCollection', features: draftFeatures });
    }

    // Sync obstacles hazard circles (including dynamic passing parameters for 3D heights)
    const obstaclesSource = map.getSource('obstacles-path') as maplibregl.GeoJSONSource;
    if (obstaclesSource) {
      const features = obstacles.map(obs => createGeoJSONCircle(
        [obs.lng, obs.lat], 
        obs.radiusMeters, 
        { height: obs.heightMeters, name: obs.type }
      ));
      obstaclesSource.setData({
        type: 'FeatureCollection',
        features: features
      });
    }

    // Clear and re-populate HTML labels for obstacles
    obstacleMarkersRef.current.forEach(m => m.remove());
    obstacleMarkersRef.current = [];

    obstacles.forEach((obs) => {
      // Small tactical dot in center
      const dotEl = document.createElement('div');
      dotEl.innerHTML = `<div class="w-1.5 h-1.5 bg-rose-500 rounded-full border border-white"></div>`;
      const dotMarker = new maplibregl.Marker({ element: dotEl })
        .setLngLat([obs.lng, obs.lat])
        .addTo(map);
      obstacleMarkersRef.current.push(dotMarker);

      // Label shifted upwards
      const labelEl = document.createElement('div');
      labelEl.className = 'custom-obstacle-tooltip select-none pointer-events-none';
      labelEl.style.transform = 'translateY(-18px)';
      labelEl.innerHTML = `
        <div class="text-[8px] font-mono font-bold text-rose-300 px-1 py-0.5 text-center bg-slate-950/90 rounded border border-rose-500/20 whitespace-nowrap shadow-md">
          ${obs.type}
        </div>
      `;
      const labelMarker = new maplibregl.Marker({ element: labelEl })
        .setLngLat([obs.lng, obs.lat])
        .addTo(map);
      obstacleMarkersRef.current.push(labelMarker);
    });

  }, [directPath, plannedPath, traveledPath, obstacles, geofence, fenceDraft, mapLoaded]);

  // Sync mission-stop (B/C/D...) markers — Feature 1/2
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    waypointMarkersRef.current.forEach(m => m.remove());
    waypointMarkersRef.current = [];

    waypoints.forEach((wp) => {
      const el = document.createElement('div');
      const spawned = wp.markerStatus === 'spawned';
      el.innerHTML = `
        <div class="flex items-center justify-center w-7 h-7 rounded-full bg-slate-950/80 border ${
          spawned ? 'border-emerald-500 text-emerald-400' : 'border-cyan-500 text-cyan-300'
        } font-bold text-[10px] font-mono shadow-lg">
          ${wp.label}
        </div>
      `;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([wp.lng, wp.lat])
        .addTo(map);
      waypointMarkersRef.current.push(marker);
    });
  }, [waypoints, mapLoaded]);

  // Fix sizing bugs when tabs are toggled
  useEffect(() => {
    if (activeTab === 'leaflet' && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.resize();
      }, 100);
    }
  }, [activeTab]);

  // Coordinates mapping parameters for simulated Radar View (centered dynamically around user's active startup location)
  const latMin = startLoc.lat - 0.013;
  const latMax = startLoc.lat + 0.013;
  const lngMin = startLoc.lng - 0.013;
  const lngMax = startLoc.lng + 0.013;

  const latToY = (lat: number) => {
    return ((latMax - lat) / (latMax - latMin)) * 100;
  };

  const lngToX = (lng: number) => {
    return ((lng - lngMin) / (lngMax - lngMin)) * 100;
  };

  const handleSimGridClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const clickedLng = lngMin + (x / 100) * (lngMax - lngMin);
    const clickedLat = latMax - (y / 100) * (latMax - latMin);

    const roundedCoord = {
      lat: Math.round(clickedLat * 1000000) / 1000000,
      lng: Math.round(clickedLng * 1000000) / 1000000
    };

    if (clickMode === 'fence') {
      onFenceVertex?.(roundedCoord);
    } else if (clickMode === 'start') {
      onSetStartLoc(roundedCoord);
    } else {
      onSetDestLoc(roundedCoord);
    }
  };

  return (
    <div id="uav-tactical-map-panel" className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[520px] relative">
      
      {/* Tab bar header */}
      <div className="bg-slate-950/40 px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md">
        <div className="flex items-center space-x-2">
          <Crosshair className="w-5 h-5 text-cyan-400 animate-pulse" />
          <div>
            <h3 className="font-semibold text-white tracking-wide text-xs uppercase font-display">Autonomous Navigation Interface</h3>
            <p className="text-[10px] text-slate-400 font-mono">Select locations, plan optimized trajectories, bypass obstacle zones</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Target Placement toggle */}
          <div className="flex bg-slate-950/60 p-0.5 border border-white/10 rounded-lg">
            <button
              id="btn-click-start"
              onClick={() => setClickMode('start')}
              className={`px-2.5 py-1 rounded text-[10.5px] font-mono leading-none transition-all cursor-pointer ${
                clickMode === 'start'
                  ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Start Coords
            </button>
            <button
              id="btn-click-dest"
              onClick={() => setClickMode('dest')}
              className={`px-2.5 py-1 rounded text-[10.5px] font-mono leading-none transition-all cursor-pointer ${
                clickMode === 'dest'
                  ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Dest Coords
            </button>
            <button
              id="btn-click-fence"
              onClick={() => setClickMode('fence')}
              className={`px-2.5 py-1 rounded text-[10.5px] font-mono leading-none transition-all cursor-pointer ${
                clickMode === 'fence'
                  ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              Fence
            </button>
          </div>

          {/* Fence drawing controls — only while in fence mode */}
          {clickMode === 'fence' && (
            <div className="flex items-center space-x-1.5 bg-slate-950/60 p-0.5 border border-amber-500/30 rounded-lg">
              <span className="px-1.5 text-[10px] font-mono text-amber-400/80">
                {fenceDraft.length > 0
                  ? `${fenceDraft.length} vertex${fenceDraft.length === 1 ? '' : 'es'}`
                  : geofence.length >= 3 ? 'fence active' : 'click map to draw'}
              </span>
              <button
                id="btn-fence-finish"
                onClick={() => onFinishFence?.()}
                disabled={fenceDraft.length < 3}
                className={`px-2.5 py-1 rounded text-[10.5px] font-mono leading-none transition-all ${
                  fenceDraft.length >= 3
                    ? 'bg-amber-500/25 text-amber-300 font-bold border border-amber-500/40 cursor-pointer'
                    : 'text-slate-600 border border-transparent cursor-not-allowed'
                }`}
              >
                Set Fence
              </button>
              <button
                id="btn-fence-clear"
                onClick={() => onClearFence?.()}
                disabled={fenceDraft.length === 0 && geofence.length === 0}
                className={`px-2.5 py-1 rounded text-[10.5px] font-mono leading-none transition-all ${
                  fenceDraft.length > 0 || geofence.length > 0
                    ? 'text-rose-400 hover:bg-rose-500/15 border border-transparent cursor-pointer'
                    : 'text-slate-600 border border-transparent cursor-not-allowed'
                }`}
              >
                Clear
              </button>
            </div>
          )}

          {/* Engine Selection Tabs */}
          <div className="flex bg-slate-950/60 p-1 border border-white/10 rounded-lg">
            <button
              id="tab-sim-engine"
              onClick={() => setActiveTab('simulation')}
              className={`px-3 py-1 rounded text-[10.5px] font-mono font-semibold transition-all cursor-pointer ${
                activeTab === 'simulation'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              SIM GRID
            </button>
            <button
              id="tab-leaflet-engine"
              onClick={() => setActiveTab('leaflet')}
              className={`px-3 py-1 rounded text-[10.5px] font-mono font-semibold transition-all tracking-wider cursor-pointer ${
                activeTab === 'leaflet'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                  : 'text-cyan-400 hover:text-white'
              }`}
            >
              MAPLIBRE MAP 3.0 ●
            </button>
          </div>
        </div>
      </div>

      {/* Map Content Viewport */}
      <div className="flex-1 bg-slate-950/30 relative overflow-hidden select-none">
        
        {/* Floating Search Base */}
        <div className="absolute top-3 right-3 z-[1005] w-72 select-text font-mono">
          <form 
            onSubmit={handleSearch} 
            className={`relative flex items-center bg-slate-950/90 border rounded-xl px-2.5 py-1.5 shadow-[0_0_15px_rgba(6,182,212,0.2)] backdrop-blur-md transition-colors ${
              clickMode === 'start' ? 'border-amber-500/50' : 'border-cyan-500/30'
            }`}
          >
            <Search className={`w-3.5 h-3.5 mr-2 shrink-0 ${clickMode === 'start' ? 'text-amber-400' : 'text-cyan-400'}`} />
            <input
              type="text"
              placeholder={clickMode === 'start' ? "Search starting location / city..." : "Search target delivery zone..."}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              className="bg-transparent border-none text-white focus:outline-none text-[11px] w-full placeholder-slate-500"
            />
            {isSearching ? (
              <Loader2 className={`w-3.5 h-3.5 animate-spin shrink-0 ml-1 ${clickMode === 'start' ? 'text-amber-400' : 'text-cyan-400'}`} />
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowDropdown(false);
                }}
                className="text-slate-500 hover:text-white text-xs shrink-0 ml-1 px-1 cursor-pointer"
              >
                ×
              </button>
            ) : null}
          </form>

          {/* Search Dropdown Results */}
          {showDropdown && (searchResults.length > 0 || searchError) && (
            <>
              <div 
                className="fixed inset-0 z-[1003]" 
                onClick={() => setShowDropdown(false)} 
              />
              <div className={`absolute right-0 left-0 mt-1.5 bg-slate-950/95 border rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto backdrop-blur-lg z-[1004] ${
                clickMode === 'start' ? 'border-amber-500/40' : 'border-cyan-500/35'
              }`}>
                {searchError ? (
                  <div className="p-3 text-[10px] text-rose-400 text-center uppercase tracking-wider">
                    ⚠️ {searchError}
                  </div>
                ) : (
                  searchResults.map((loc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectLocation(loc)}
                      className="w-full text-left p-2.5 text-[10px] text-slate-300 hover:bg-cyan-500/15 hover:text-cyan-200 border-b border-white/5 transition-colors flex items-start space-x-2 last:border-b-0 cursor-pointer"
                    >
                      <MapPin className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${clickMode === 'start' ? 'text-amber-500' : 'text-emerald-400'}`} />
                      <div className="flex-1 truncate">
                        <div className="font-bold text-white truncate">{loc.name || 'Location ' + (idx + 1)}</div>
                        <div className="text-slate-400 truncate text-[9px] mt-0.5">{loc.display_name}</div>
                        <div className="text-cyan-400/80 text-[8px] mt-0.5 font-bold">
                          Lat: {parseFloat(loc.lat).toFixed(5)} | Lng: {parseFloat(loc.lon).toFixed(5)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {activeTab === 'simulation' ? (
          /* Custom High-Tech simulated Radar/Telemetry Canvas grid */
          <div className="absolute inset-0 flex flex-col justify-between">
            {/* Legend Indicators overlay */}
            <div className="absolute top-3 left-3 z-10 bg-slate-950/80 border border-white/10 p-3 rounded-xl font-mono text-[9.5px] text-slate-300 space-y-1.5 shadow-xl max-w-[210px] backdrop-blur-md">
              <div className="text-cyan-400 font-bold border-b border-white/10 pb-1 mb-1 text-[10px] uppercase tracking-wide">Radar Vector Legend</div>
              <div className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-2 shrink-0" /> UAV Base Transceiver (S)</div>
              <div className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2 shrink-0 animate-pulse" /> Delivery Destination (D)</div>
              <div className="flex items-center"><div className="w-3 h-0.5 bg-amber-600 mr-2 shrink-0" /> Standard Path (Direct/Unsafe)</div>
              <div className="flex items-center"><div className="w-3 h-0.5 bg-cyan-400 mr-2 shrink-0" /> Optimized Path (Safe/Avoided)</div>

              <div className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-rose-500/20 border border-rose-500 animate-pulse mr-2 shrink-0" /> Dynamic Obstacle Zone</div>
              {avoidanceActive && (
                <div className="pt-1 border-t border-slate-800 text-amber-400 font-bold animate-pulse uppercase flex items-center shrink-0">
                  <ShieldAlert className="w-3.5 h-3.5 mr-1" /> LiDAR evasive lock on
                </div>
              )}
            </div>

            {/* Simulated Vector SVG Drawing Box */}
            <svg
              id="canvas-radar-grid"
              className="w-full h-full cursor-crosshair"
              onClick={handleSimGridClick}
            >
              {/* Coordinate grid lines */}
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((perc) => (
                <React.Fragment key={perc}>
                  {/* Vertical lines */}
                  <line
                     x1={`${perc}%`}
                     y1="0"
                     x2={`${perc}%`}
                     y2="100%"
                     stroke="#1e293b"
                     strokeWidth="0.5"
                     strokeOpacity="0.4"
                  />
                  {/* Horizontal lines */}
                  <line
                     x1="0"
                     y1={`${perc}%`}
                     x2="100%"
                     y2={`${perc}%`}
                     stroke="#1e293b"
                     strokeWidth="0.5"
                     strokeOpacity="0.4"
                  />
                </React.Fragment>
              ))}

              {/* Draw concentric circular radar range rings center at Drone start */}
              <circle
                cx={`${lngToX(startLoc.lng)}%`}
                cy={`${latToY(startLoc.lat)}%`}
                r="80"
                fill="none"
                stroke="#6366f1"
                strokeWidth="0.5"
                strokeOpacity="0.12"
              />
              <circle
                cx={`${lngToX(startLoc.lng)}%`}
                cy={`${latToY(startLoc.lat)}%`}
                r="160"
                fill="none"
                stroke="#6366f1"
                strokeWidth="0.5"
                strokeOpacity="0.08"
              />

              {/* Draw Obstacles circle boundaries */}
              {obstacles.map((obs) => {
                const cx = lngToX(obs.lng);
                const cy = latToY(obs.lat);
                return (
                  <g key={obs.id}>
                    {/* Semi-transparent hazard zone */}
                    <circle
                      cx={`${cx}%`}
                      cy={`${cy}%`}
                      r={obs.radiusMeters * 3.5}
                      fill="url(#obstacleHazard)"
                      stroke="#f43f5e"
                      strokeWidth="1.5"
                      strokeOpacity="0.8"
                      strokeDasharray="4,4"
                      className="animate-pulse"
                    />
                    {/* Centered obstacle physical dot */}
                    <circle
                      cx={`${cx}%`}
                      cy={`${cy}%`}
                      r="4"
                      fill="#f43f5e"
                    />
                    {/* Label */}
                    <text
                      x={`${cx}%`}
                      y={`${cy - 2}%`}
                      fill="#fda4af"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="middle"
                      fontWeight="bold"
                    >
                      {obs.type}
                    </text>
                  </g>
                );
              })}

              {/* Definitions mapping */}
              <defs>
                <radialGradient id="obstacleHazard">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.03" />
                </radialGradient>
              </defs>

              {/* Draw Paths segments */}
              {directPath.length > 1 && (
                <polyline
                  points={directPath
                    .map((p, i) => {
                      const latPercent = latToY(directPath[i].lat);
                      const lngPercent = lngToX(directPath[i].lng);
                      return `${lngPercent}%,${latPercent}%`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="1.5"
                  strokeDasharray="4,3"
                  className="transition-all duration-300"
                />
              )}

              {plannedPath.length > 1 && (
                <polyline
                  points={plannedPath
                    .map((p, i) => {
                      const latPercent = latToY(plannedPath[i].lat);
                      const lngPercent = lngToX(plannedPath[i].lng);
                      return `${lngPercent}%,${latPercent}%`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  className="transition-all duration-300"
                />
              )}

              {/* Coordinates label at START */}
              <text
                x={`${lngToX(startLoc.lng)}%`}
                y={`${latToY(startLoc.lat) + 3.5}%`}
                fill="#f59e0b"
                fontSize="9"
                fontFamily="monospace"
                textAnchor="middle"
                fontWeight="semibold"
              >
                S [{startLoc.lat.toFixed(5)}, {startLoc.lng.toFixed(5)}]
              </text>

              {/* Start anchor node */}
              <circle
                cx={`${lngToX(startLoc.lng)}%`}
                cy={`${latToY(startLoc.lat)}%`}
                r="7"
                fill="#ffb020"
                stroke="#ffffff"
                strokeWidth="1.5"
              />

              {/* Destination anchor node */}
              {destLoc && (
                <g>
                  <circle
                    cx={`${lngToX(destLoc.lng)}%`}
                    cy={`${latToY(destLoc.lat)}%`}
                    r="8"
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="animate-ping"
                    style={{ animationDuration: '2s' }}
                  />
                  <circle
                    cx={`${lngToX(destLoc.lng)}%`}
                    cy={`${latToY(destLoc.lat)}%`}
                    r="6"
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x={`${lngToX(destLoc.lng)}%`}
                    y={`${latToY(destLoc.lat) - 2.5}%`}
                    fill="#34d399"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight="semibold"
                  >
                    D [{destLoc.lat.toFixed(5)}, {destLoc.lng.toFixed(5)}]
                  </text>
                </g>
              )}

              {/* Dynamic Flight Drone Copter representation */}
              <g className="transition-all duration-200">
                <g
                  transform={`translate(${lngToX(dronePos.lng) - 50}px, ${latToY(dronePos.lat) - 50}px) rotate(${dronePos.heading}deg) scale(0.85)`}
                  className="origin-center"
                >
                  {/* Blinking radio range aura */}
                  <circle cx="0" cy="0" r="16" fill="rgba(99, 102, 241, 0.15)" stroke="rgba(99, 102, 241, 0.4)" strokeWidth="1" className="animate-ping" />
                  
                  {/* Drone graphic body skeleton */}
                  <line x1="-15" y1="-15" x2="15" y2="15" stroke="#ffffff" strokeWidth="2.5" />
                  <line x1="-15" y1="15" x2="15" y2="-15" stroke="#ffffff" strokeWidth="2.5" />
                  
                  {/* Rotor spinning overlays (4 circular endpoints) */}
                  <circle cx="-15" cy="-15" r="4" fill="none" stroke="#6366f1" strokeWidth="1" className="animate-spin" style={{ animationDuration: '0.2s' }} />
                  <circle cx="15" cy="-15" r="4" fill="none" stroke="#6366f1" strokeWidth="1" className="animate-spin" style={{ animationDuration: '0.2s' }} />
                  <circle cx="-15" cy="15" r="4" fill="none" stroke="#6366f1" strokeWidth="1" className="animate-spin" style={{ animationDuration: '0.2s' }} />
                  <circle cx="15" cy="15" r="4" fill="none" stroke="#6366f1" strokeWidth="1" className="animate-spin" style={{ animationDuration: '0.2s' }} />
                  
                  {/* Central GPS receiver block */}
                  <circle cx="0" cy="0" r="6" fill={emergencyLandingActive ? "#ef4444" : "#6366f1"} stroke="#ffffff" strokeWidth="1.5" />
                  {/* Pointer arrow indicating heading direction */}
                  <polygon points="0,-12 -3,-5 3,-5" fill="#f43f5e" />
                </g>
              </g>

            </svg>

            {/* Radar Coordinates Monitor Footer strip */}
            <div className="bg-slate-950 px-4 py-2 border-t border-slate-900 flex justify-between items-center text-[10.5px] text-slate-400 font-mono">
              <span className="flex items-center"><RefreshCw className={`w-3 h-3 mr-1 text-cyan-400 ${flightState === FlightState.EN_ROUTE ? 'animate-spin' : ''}`} /> UAV Drone telemetry matching</span>
              <span>Coordinates: {dronePos.lat.toFixed(6)}, {dronePos.lng.toFixed(6)} | Heading: {dronePos.heading.toFixed(1)}°</span>
            </div>
          </div>
        ) : (
          /* Live MapLibre Geographic Map viewport */
          <div className="w-full h-full relative" style={{ minHeight: '100%' }}>
            <div 
              ref={containerRef} 
              className="w-full h-full text-slate-950" 
              style={{ background: '#0b1329', minHeight: '450px' }} 
            />
            {/* Custom overlay instructions indicating standard mouse handlers */}
            <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2">
              <div className="bg-slate-950/85 border border-white/10 p-2.5 rounded-lg text-[10px] font-mono text-slate-400 backdrop-blur-md pointer-events-none uppercase tracking-wide">
                🖱️ Left: Point | Right + Drag: Pitch/Rotate
              </div>
              <button
                id="btn-toggle-3d-perspective"
                type="button"
                onClick={toggle3DMode}
                className={`px-3 py-2 border rounded-xl text-[10.5px] font-mono uppercase tracking-wide font-bold backdrop-blur-md transition-all cursor-pointer shadow-lg flex items-center gap-1.5 ${
                  is3DMode 
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30' 
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 ${is3DMode ? 'text-cyan-400' : 'text-slate-400'}`} />
                {is3DMode ? '3D Active' : 'Enable 3D'}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

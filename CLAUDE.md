# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this project is

A ground-control station (GCS) for an autonomous A→B(→C→D…) waypoint drone.
It is **one half of a two-repo system**:

| Piece | Where it lives | What it does |
|---|---|---|
| Web dashboard (`src/`) | this repo | React 19 + Vite + Tailwind v4 mission-control UI |
| FastAPI ↔ ROS 2 bridge (`backend/`) | this repo, but **runs on the ROS 2 machine** | REST + WebSocket + MJPEG bridge, PX4 safety gate, SQLite travel log |
| ROS 2 flight stack (`drone_interfaces`, `mission_manager`, `waypoint_navigator`, `aruco_landing`, …) | **NOT in this repo** — `~/drone_ws2/src/autonomous_drone_ros2` | actual flight logic, PX4/MAVROS control, ArUco landing |

The flight stack is the authority on flying. This repo plans missions, gates
them, streams telemetry, and records what happened.

Vehicle side: PX4 (SITL under Gazebo, or real hardware) ← MAVROS → ROS 2 nodes ←
`backend/main.py` → HTTP/WS → browser.

## Commands

```bash
npm install
npm run dev       # Vite dev server on :3000 (--host 0.0.0.0)
npm run build     # production build to dist/
npm run preview
npm run lint      # tsc --noEmit — the ONLY check in the repo
npm run clean     # rm -rf dist server.js
```

There is **no test suite, no ESLint, no formatter, and no CI**. `npm run lint`
(a bare `tsc --noEmit`) is the whole automated safety net — run it after any
TypeScript change.

Backend (on the ROS 2 machine only):

```bash
source /opt/ros/humble/setup.bash
source ~/drone_ws2/install/setup.bash    # provides drone_interfaces
python3 backend/main.py                  # uvicorn on :8000 + rclpy spin
```

`backend/main.py` **cannot be imported or run in this repo's environment** — it
requires `rclpy`, `cv_bridge`, `mavros_msgs`, and the out-of-tree
`drone_interfaces` package. Do not try to "fix" those imports; reason about the
backend by reading it.

## Layout

```
src/
  main.tsx                    React root (StrictMode — mount effects double-fire in dev)
  App.tsx                     ~1000 lines: ALL mission state lives here, passed down as props
  api.ts                      every backend call; API_BASE / WS_BASE; ApiError
  types.ts                    shared TS types incl. the WebSocket message union
  index.css                   Tailwind v4 @theme (Inter / Space Grotesk / JetBrains Mono)
  hooks/useSystemStatusSocket.ts   WS client with exponential-backoff reconnect
  components/
    MapPane.tsx               MapLibre GL map: waypoints, geofence draw, paths, drone marker
    MapErrorBoundary.tsx      map crash must not take down arm/abort controls
    FlightControlPanel.tsx    launch / abort / RTH / reset / GPS sync / arm
    WaypointList.tsx          stops B,C,D…, per-stop alt, speed, land mode, ground wait
    FlightTestBench.tsx       second page: manual arm/takeoff/land + directional nudge pad
    CameraFeed.tsx            MJPEG <img> from /camera/stream (+ simulated fallback)
    IMUGraph.tsx              attitude / angular-rate traces from the WS IMU push
    SensorReadout.tsx         climate, signal, lidar — mostly simulated
    TelemetryTerminal.tsx     exports TelemetryLogStream + TelemetryInsights
    ConnectivityBanner.tsx    renders the backend preflight gate's failure reasons
    DroneProfilePanel.tsx     hardware profile + range estimate + sim/hardware toggle
backend/
  main.py                     FastAPI app + BridgeNode(rclpy.Node) — the whole bridge
  db.py                       SQLite at ~/drone_ws2/travel_log.db
  range_estimate.py           deliberately-rough flight-time/range estimator
```

There is no state-management library and no router. `App.tsx` holds state;
`activePage` (`'mission' | 'testbench'`) is the page switch.

## Backend API surface (`backend/main.py`)

| Method | Path | Gated by `_require_all_clear()`? |
|---|---|---|
| POST | `/mission/upload` | yes (after per-waypoint fence/altitude validation) |
| POST | `/mission/start` | yes |
| POST | `/mission/abort` | **no** — must work when things are degraded |
| POST | `/mission/reset` | no |
| POST | `/mission/return-home` | **no** — deliberate, see the docstring |
| POST | `/drone/arm` | yes |
| POST | `/drone/disarm` | no |
| POST | `/drone/takeoff`, `/drone/land` | no — narrower bench-specific checks |
| POST | `/drone/manual/{cmd}` | no — narrower, so indoor bench testing works |
| GET | `/mission/status` | no |
| POST | `/markers/generate` | yes, and sim-only |
| POST/GET | `/system/set-home`, `/system/home` | no — settable before the stack is up |
| GET/POST/DELETE | `/geofence` | no — same reason |
| GET/POST | `/system/mode`, `/system/profile` | no |
| GET | `/missions/{id}/travel-log` | no |
| GET | `/camera/stream` (MJPEG), `/camera/snapshot` | no |
| WS | `/ws/system-status` | no |

**The un-gated endpoints are un-gated on purpose.** Each has a docstring
explaining why. Do not "tighten" them into `_require_all_clear()` — an operator
needs abort and return-home precisely when connectivity is bad.

Gate checks (`BridgeNode.all_clear()`): `mavros_connected`, `nodes_alive`,
`gps_lock`, `home_set`, `battery_ok`, `home_position_match`, `geofence_valid`.
Failures come back as HTTP 503 `{"detail": {"reasons": [...]}}`; `ApiError`
carries them to `ConnectivityBanner`, which maps reason codes to human text.
Add a new reason code → add a label in `ConnectivityBanner.REASON_LABELS`.

WebSocket `/ws/system-status` pushes a discriminated union (`SystemStatusMessage`
in `types.ts`): `node_status` | `imu` | `position` | `mission_state`. Adding a
message type means touching `types.ts`, `useSystemStatusSocket.ts`, and the
consumer in `App.tsx`.

## Conventions that matter

**WS-primary, REST-fallback.** Position, altitude, and mission state arrive both
over the WebSocket push and the 500 ms `getMissionStatus()` poll. Every REST-poll
branch in `App.tsx` is wrapped in `if (!wsConnected)`. Keep that split — dropping
it makes the two sources fight over `dronePos`.

**`(0, 0)` means "no GPS fix yet", never Null Island.** Enforced in `_gps_cb`
(drops invalid/no-fix `NavSatFix`), in `/mission/status` (returns `null` lat/lon),
and in the WS position effect in `App.tsx`. Preserve all three.

**Safety is enforced server-side; the UI is monitoring-only.** Client-side
altitude aborts and gate displays are convenience mirrors. Never move an
authoritative check into the browser.

**Comments are a flight log.** Much of this codebase carries dated findings from
real SITL/hardware sessions ("confirmed live 2026-07-11: …"). They explain
non-obvious constants and why an approach that looks simpler was rejected —
e.g. `NAV_DLL_ACT` must be zeroed or arming always fails; MAVROS param setting
must use `rcl_interfaces/SetParameters`, not `mavros_msgs/ParamSet`; the altitude
abort needs a debounce and a ground-relative reference because of SITL EKF z-drift.
**Do not delete or "clean up" these comments.** When you change the behaviour they
describe, update them and add why.

**Retry-until-confirmed for FCU state.** `NAV_DLL_ACT` and the geofence push both
run on rclpy timers that keep retrying after each MAVROS (re)connect, because a
fresh PX4 process starts with neither. Follow that pattern for anything else that
must survive a PX4 restart.

**Geofence lives in PX4 itself**, uploaded QGC-style as
`NAV_FENCE_POLYGON_VERTEX_INCLUSION` items plus `GF_ACTION`, so breach
enforcement survives the backend/website dying mid-flight. The backend's own
polygon check is an additional pre-upload validation, not the enforcement.

**Styling.** Tailwind v4 utility classes inline, dark panels
(`bg-[#141417] border border-white/10 rounded-2xl`), accent `#5996FF`, test-bench
accent `#1ebcbd`, `font-mono` + `uppercase` + `text-[10px]` for labels. Icons are
`lucide-react`. No component library. Match the surrounding panel idiom rather
than introducing new patterns.

## Known drift and dead weight (don't be surprised by these)

- **`ABORT_ALTITUDE_M` is out of sync**: `backend/main.py` = `20.0` (ground-relative,
  debounced), `App.tsx` = `10.0`, and the comment in `App.tsx` says to keep them in
  sync. The backend value is authoritative; the frontend one only trips when the
  WebSocket is down. Prefer fixing the frontend to match rather than the reverse,
  and only with the operator's intent confirmed — this is a safety limit.
- `MQTT_README.md` and `ROS2_FASTAPI_README.md` are **standalone integration
  blueprints, not documentation of `backend/main.py`**. The endpoints they show
  (`/api/telemetry`, `/api/command`) and the MQTT topic tree do not exist in this
  code. Don't treat them as the API contract.
- `README.md` is the leftover Google AI Studio scaffold README plus an ASCII
  mockup. Largely stale.
- Unused dependencies from that scaffold: `@google/genai`, `express`,
  `mapbox-gl`, `@vis.gl/react-google-maps`, `leaflet`, `dotenv`, `tsx`. The map is
  **MapLibre GL** against the free Carto dark-matter style, with Nominatim for
  geocoding search — no key required.
- `apiKey` / `hasValidKey` are threaded into `MapPane` and never used.
  `GEMINI_API_KEY` and `VITE_MAPBOX_ACCESS_TOKEN` in `.env.example` are unused.
- `_set_mavros_param` has an unreachable `future.add_done_callback(_on_result)`
  after its `return` (harmless leftover).
- `assets/` is effectively empty.

## Environment

`.env.local` (git-ignored; `.env*` is ignored except `.env.example`):

- `VITE_API_URL` — backend base URL, default `http://localhost:8000`. `WS_BASE`
  is derived from it by swapping `http`→`ws`.
- `GOOGLE_MAPS_PLATFORM_KEY` — injected via `vite.config.ts` `define`; currently
  vestigial.
- `DISABLE_HMR=true` — disables HMR *and* file watching (AI Studio agent-edit
  mode). The comment in `vite.config.ts` asks that this not be modified.

Backend CORS allows `localhost`/`127.0.0.1` on ports **3000 and 5173**. `npm run
dev` serves on 3000; if you change the dev port, update the CORS list too.

Persistent state lives outside the repo: `~/drone_ws2/travel_log.db` (SQLite,
WAL) and `~/drone_ws2/.last_synced_home`. Tables: `missions`, `travel_points`,
`safety_events`, `system_config` (key/JSON), `drone_profile` (single row, `id=1`).

## Mission flow (end to end)

1. Operator syncs laptop geolocation → `POST /system/set-home` (SITL home; real
   hardware gets home from GPS). High-accuracy fix first, network-based fallback.
2. Optional: draw a geofence polygon on the map → `POST /geofence` → pushed into PX4.
3. Click the map to add stops `B`, `C`, `D`… (`nextStopLetter` ref), set per-stop
   altitude, cruise speed, land mode (`aruco` precision landing vs plain `gps`
   AUTO.LAND), and ground wait.
4. Optional (sim only): generate + spawn an ArUco pad per stop → `POST /markers/generate`.
5. Launch → `POST /mission/upload` (validates fence + altitude + estimated range,
   then gates) → `POST /mission/start` (re-publishes waypoints before `START`,
   because the one-shot publish on upload can be lost to DDS discovery).
6. `mission_manager` runs the state machine; the backend mirrors `/mission/status`,
   opens a `missions` row while airborne, and logs a travel point at 1 Hz.
7. Abort / return-home / altitude-ceiling abort as needed; on landing the frontend
   auto-fires `POST /mission/reset` after 4 s so the next mission can launch
   (`mission_manager` never returns to `IDLE` on its own).

`FlightState` in `types.ts` (UI) and the backend's `mission_state` strings
(`PREFLIGHT`, `TAKEOFF`, `GOTO_WAYPOINT`, `ARUCO_LAND`, `WAIT_ON_GROUND`,
`INTER_TAKEOFF`, `RETURN_HOME`, `HOME_LAND`, `PX4_FAILSAFE`,
`MISSION_COMPLETE`, `MISSION_ABORT`) are **different vocabularies** — the mapping
is done ad hoc in `App.tsx`. `AIRBORNE_MISSION_STATES` in `main.py` is what opens
and closes a travel-log row.

## Working in this repo

- Default branch is `main`; work happens on feature branches (`ui_branch`, and
  `claude/*` branches for assistant work) merged via PR.
- Commit subjects are short and scoped, often prefixed with the affected side:
  `UI: …`, `Backend: …`, `Website: …`, or a plain imperative summary.
- Changes that touch safety limits, the preflight gate, or the abort paths deserve
  an explicit note in the commit body about what was verified and how — that is
  the established habit here, and the reason the inline comments are so detailed.
- Frontend-only changes can be verified with `npm run lint` and the dev server.
  Anything touching `backend/` cannot be executed here; be conservative, keep the
  ROS 2 threading model intact (rclpy callbacks run on a different thread than
  uvicorn's loop — cross-thread WS pushes must go through `push_from_ros_thread`).

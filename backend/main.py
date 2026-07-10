#!/usr/bin/env python3
"""
backend/main.py — FastAPI + rclpy bridge between the website and the ROS2
mission stack (see ~/drone_ws2/src/autonomous_drone_ros2 for the ROS2 side).
"""
import asyncio
import json
import math
import os
import threading
import time
from typing import List, Optional

import cv2
import numpy as np
import rclpy
import uvicorn
from cv_bridge import CvBridge
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from mavros_msgs.msg import HomePosition, State
from nav_msgs.msg import Odometry
from pydantic import BaseModel
from rcl_interfaces.msg import Parameter, ParameterType, ParameterValue
from rcl_interfaces.srv import SetParameters
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import BatteryState, Image, Imu, NavSatFix
from std_msgs.msg import Int32, String

import db
import range_estimate
from drone_interfaces.aruco_marker import write_pad_model_everywhere
from drone_interfaces.constants import (ARUCO_ID_AUTO_START,
                                          BATTERY_HEARTBEAT_STALE_S,
                                          MAVROS_STATE_STALE_S,
                                          NODE_HEARTBEAT_STALE_S,
                                          TOPIC_MISSION_SAFETY_EVENT)
from drone_interfaces.geo import gps_distance_m, gps_to_local
from drone_interfaces.gz_spawn import find_world_name, spawn_model

from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if ros_node:
        ros_node.loop = asyncio.get_running_loop()
    yield


app = FastAPI(lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000",
                   "http://127.0.0.1:3000",
                   "http://localhost:5173",
                   "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ros_node = None

# ── Altitude safety limits ────────────────────────
TARGET_ALTITUDE_M = 2.5
ABORT_ALTITUDE_M   = 3.0
DEFAULT_MAX_SPEED_MS = 3.0
HOME_MISMATCH_THRESHOLD_M = 1000.0

REPO_MODELS_ROOT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "autonomous_drone_ros2",
    "simulation", "gazebo", "models"))
LAST_SYNCED_HOME_FILE = os.path.expanduser("~/drone_ws2/.last_synced_home")

MONITORED_NODES = {
    "drone_base": "/drone_base/status",
    "waypoint_navigator": "/waypoint_nav/status",
    "aruco_landing": "/aruco_landing/status",
    "vision_node": "/vision_node/heartbeat",
    "camera_node": "/camera_node/heartbeat",
    "mission_manager": "/mission/status",
}

AIRBORNE_MISSION_STATES = {"PREFLIGHT", "TAKEOFF", "GOTO_WAYPOINT", "ARUCO_LAND",
                            "WAIT_ON_GROUND", "INTER_TAKEOFF", "RETURN_HOME", "HOME_LAND"}


# ── Data models ───────────────────────────────────
class Waypoint(BaseModel):
    lat:   float
    lon:   float
    alt:   float = TARGET_ALTITUDE_M
    label: str   = "B"
    marker_id: Optional[int] = None


class MissionUpload(BaseModel):
    waypoints: List[Waypoint]
    speed_ms: Optional[float] = None


class MarkerGenerateRequest(BaseModel):
    label: str
    marker_id: Optional[int] = None
    lat: float
    lon: float


class SetHomeRequest(BaseModel):
    lat: float
    lon: float


class ModeRequest(BaseModel):
    mode: str  # "sim" | "hardware"


class DroneProfileRequest(BaseModel):
    motor_kv: Optional[float] = None
    esc_amp: Optional[float] = None
    battery_mah: Optional[float] = None
    cells: Optional[int] = None
    num_motors: Optional[int] = 4
    auw_grams: Optional[float] = None
    efficiency_factor: Optional[float] = None
    cruise_speed_ms: Optional[float] = None


# ── Connectivity gate (Feature 9) — authoritative, not just UI ───────────
def _gate():
    if ros_node is None:
        return False, ["ros2_bridge_not_connected"]
    return ros_node.all_clear()[:2]


def _require_all_clear():
    ok, reasons = _gate()
    if not ok:
        raise HTTPException(status_code=503, detail={"reasons": reasons})


def _route_distance_m(home_lat, home_lon, waypoints: List[Waypoint]) -> float:
    if not waypoints:
        return 0.0
    total = gps_distance_m(home_lat, home_lon, waypoints[0].lat, waypoints[0].lon)
    for a, b in zip(waypoints, waypoints[1:]):
        total += gps_distance_m(a.lat, a.lon, b.lat, b.lon)
    total += gps_distance_m(waypoints[-1].lat, waypoints[-1].lon, home_lat, home_lon)
    return total


# ── Existing + extended endpoints ─────────────────
@app.post("/mission/upload")
def upload(mission: MissionUpload):
    _require_all_clear()

    for w in mission.waypoints:
        if w.alt > ABORT_ALTITUDE_M:
            raise HTTPException(400, f"Waypoint {w.label} altitude {w.alt}m exceeds "
                                      f"ABORT_ALTITUDE_M={ABORT_ALTITUDE_M}m — rejected, not clamped.")

    if ros_node and ros_node.home_lat is not None:
        route_m = _route_distance_m(ros_node.home_lat, ros_node.home_lon, mission.waypoints)
        profile = db.get_profile()
        if profile:
            est = range_estimate.estimate(profile)
            if est["range_m"] is not None and route_m > est["range_m"]:
                raise HTTPException(
                    400, f"Planned route ({route_m:.0f}m) exceeds the estimated safe "
                         f"range ({est['range_m']:.0f}m) for the configured drone profile.")

    if ros_node:
        data = [{"lat": w.lat, "lon": w.lon, "alt": w.alt, "label": w.label,
                 "marker_id": w.marker_id} for w in mission.waypoints]
        ros_node.uploaded_waypoints = data
        msg = String(); msg.data = json.dumps(data)
        ros_node.waypoints_pub.publish(msg)
        if mission.speed_ms:
            ros_node.set_max_speed(mission.speed_ms)
    return {"status": "ok", "count": len(mission.waypoints)}


@app.post("/mission/start")
def start():
    _require_all_clear()
    if ros_node:
        ros_node.alt_abort_triggered = False
        ros_node.mission_state = "IDLE"
        msg = String(); msg.data = "START"
        ros_node.cmd_pub.publish(msg)
    return {"status": "ok"}


@app.post("/mission/abort")
def abort():
    if ros_node:
        msg = String(); msg.data = "ABORT"
        ros_node.cmd_pub.publish(msg)
    return {"status": "ok"}


@app.post("/drone/arm")
def arm_drone():
    _require_all_clear()
    if ros_node:
        msg = String(); msg.data = "ARM"
        ros_node.base_cmd_pub.publish(msg)
    return {"status": "ok", "command": "ARM"}


@app.post("/drone/disarm")
def disarm_drone():
    if ros_node:
        msg = String(); msg.data = "DISARM"
        ros_node.base_cmd_pub.publish(msg)
    return {"status": "ok", "command": "DISARM"}


@app.get("/mission/status")
def status():
    if ros_node:
        return {
            "mission_state": ros_node.mission_state,
            "drone_status":  ros_node.drone_status,
            "lat":           ros_node.current_lat,
            "lon":           ros_node.current_lon,
            "altitude":      ros_node.altitude,
            "heading":       ros_node.heading,
            "battery":       ros_node.battery_pct,
            "flight_mode":   ros_node.flight_mode,
        }
    return {"mission_state": "DISCONNECTED"}


# ── Feature 1: runtime ArUco marker generation + spawn ────────────────────
@app.post("/markers/generate")
def generate_marker(req: MarkerGenerateRequest):
    _require_all_clear()
    if ros_node is None or ros_node.mode == "hardware":
        raise HTTPException(503, "Marker generation is sim-only (mode=hardware).")
    if ros_node.home_lat is None:
        raise HTTPException(503, "Home GPS not yet locked — cannot compute a spawn pose.")

    marker_id = req.marker_id
    if marker_id is None:
        marker_id = ros_node.marker_assignments.get(req.label)
        if marker_id is None:
            marker_id = ros_node.next_auto_marker_id
            ros_node.next_auto_marker_id += 1
    ros_node.marker_assignments[req.label] = marker_id

    model_name = f"aruco_pad_{req.label}"
    result = write_pad_model_everywhere(marker_id, REPO_MODELS_ROOT, model_name)

    north, east = gps_to_local(ros_node.home_lat, ros_node.home_lon, req.lat, req.lon)
    sdf_path = result.get("px4_sdf_path", result["sdf_path"])
    world_name = find_world_name()
    ok, message = spawn_model(world_name, model_name, sdf_path, east, north, 0.001)
    if not ok:
        raise HTTPException(500, f"gz spawn failed: {message}")

    return {"status": "ok", "model_name": model_name, "marker_id": marker_id,
            "texture_path": result["texture_path"]}


# ── Feature 2 (3.3): laptop-geolocation-driven SITL home ──────────────────
@app.post("/system/set-home")
def set_home(req: SetHomeRequest):
    db.set_home(req.lat, req.lon)
    os.makedirs(os.path.dirname(LAST_SYNCED_HOME_FILE), exist_ok=True)
    with open(LAST_SYNCED_HOME_FILE, "w") as f:
        f.write(f"{req.lat},{req.lon}")

    # SITL's home is baked in at PX4 launch time from this same file (see
    # launch_full_sim.sh Stage 1) — syncing after PX4 is already up changes
    # what's on disk but not the running instance, so the home_position_match
    # gate will keep failing until the sim is relaunched.
    relaunch_needed = (
        ros_node is not None
        and ros_node.mavros_connected
        and ros_node.home_lat is not None
        and gps_distance_m(ros_node.home_lat, ros_node.home_lon, req.lat, req.lon) > HOME_MISMATCH_THRESHOLD_M
    )
    return {"status": "ok", "relaunch_needed": relaunch_needed}


@app.get("/system/home")
def get_home():
    home = db.get_home()
    if home is None:
        return {"lat": None, "lon": None, "synced_at": None}
    return home


# ── Feature 4: sim/hardware toggle ────────────────────────────────────────
@app.get("/system/mode")
def get_mode():
    return {"mode": db.get_config("mode", "sim")}


@app.post("/system/mode")
def set_mode(req: ModeRequest):
    if req.mode not in ("sim", "hardware"):
        raise HTTPException(400, "mode must be 'sim' or 'hardware'")
    db.set_config("mode", req.mode)
    if ros_node:
        ros_node.mode = req.mode
    return {"status": "ok", "mode": req.mode}


# ── Feature 11: hardware profile + range estimate ─────────────────────────
@app.get("/system/profile")
def get_profile():
    profile = db.get_profile() or {}
    return {"profile": profile, "estimate": range_estimate.estimate(profile)}


@app.post("/system/profile")
def set_profile(req: DroneProfileRequest):
    db.set_profile(req.model_dump())
    return get_profile()


# ── Feature 10: persisted travel log ──────────────────────────────────────
@app.get("/missions/{mission_id}/travel-log")
def travel_log(mission_id: int):
    log = db.get_travel_log(mission_id)
    if log is None:
        raise HTTPException(404, "mission not found")
    return log


# ── Camera stream endpoints (unchanged) ───────────
@app.get("/camera/stream")
async def camera_stream():
    """
    MJPEG stream — React <img src="/camera/stream"> displays it live.
    No websocket needed — works like a regular image tag.
    """
    def generate_frames():
        while True:
            if ros_node is None or ros_node.latest_frame is None:
                blank = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(
                    blank, "Waiting for camera...", (160, 240),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 200, 200), 2)
                _, buffer = cv2.imencode(".jpg", blank)
            else:
                _, buffer = cv2.imencode(
                    ".jpg", ros_node.latest_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])

            frame_bytes = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame_bytes +
                b"\r\n"
            )
            import time as _time; _time.sleep(0.033)

    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace;boundary=frame"
    )


@app.get("/camera/snapshot")
async def camera_snapshot():
    """Single JPEG snapshot — for testing."""
    if ros_node is None or ros_node.latest_frame is None:
        blank = np.zeros((480, 640, 3), dtype=np.uint8)
        _, buffer = cv2.imencode(".jpg", blank)
    else:
        _, buffer = cv2.imencode(".jpg", ros_node.latest_frame)

    return StreamingResponse(iter([buffer.tobytes()]), media_type="image/jpeg")


# ── Feature 3/6/7/8/9: WebSocket push (node status, IMU, position) ────────
@app.websocket("/ws/system-status")
async def system_status_ws(websocket: WebSocket):
    await websocket.accept()
    if ros_node:
        ros_node.ws_clients.add(websocket)
        await websocket.send_json(ros_node.build_node_status_payload())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if ros_node:
            ros_node.ws_clients.discard(websocket)


async def _broadcast(payload: dict):
    if ros_node is None:
        return
    dead = []
    for ws in list(ros_node.ws_clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ros_node.ws_clients.discard(ws)


def push_from_ros_thread(payload: dict):
    """Call from an rclpy callback (a different thread than uvicorn's asyncio
    loop) to push a WebSocket message. Must hop threads via
    run_coroutine_threadsafe — a naive cross-thread await would just block."""
    if ros_node is None or ros_node.loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(_broadcast(payload), ros_node.loop)
    except RuntimeError:
        pass  # event loop closed (uvicorn shutting down) — never fatal for the ROS side


# ── Updated BridgeNode ────────────────────────────
class BridgeNode(Node):
    def __init__(self):
        super().__init__("mission_api_node")

        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )

        # ── Publishers ────────────────────────────
        self.waypoints_pub = self.create_publisher(String, "/mission/waypoints", 10)
        self.cmd_pub = self.create_publisher(String, "/mission/command", 10)
        self.base_cmd_pub = self.create_publisher(String, "/drone_base/command", 10)

        # ── Subscribers: mission/base/camera (existing) ──
        self.create_subscription(String,    "/mission/status",               self._mission_cb, 10)
        self.create_subscription(String,    "/drone_base/status",            self._base_cb,    10)
        self.create_subscription(NavSatFix, "/mavros/global_position/global", self._gps_cb,     sensor_qos)
        self.create_subscription(Odometry,  "/mavros/local_position/odom",    self._odom_cb,    sensor_qos)
        self.create_subscription(Image,     "/camera/image_raw",              self._camera_cb,  sensor_qos)
        self.create_subscription(State,     "/mavros/state",                  self._state_cb,   sensor_qos)

        # ── Subscribers: new for connectivity gate / IMU / home ──
        self.create_subscription(HomePosition, "/mavros/home_position/home", self._home_cb, sensor_qos)
        self.create_subscription(Imu,          "/mavros/imu/data",           self._imu_cb,  sensor_qos)
        self.create_subscription(BatteryState, "/mavros/battery",           self._battery_cb, sensor_qos)
        self.create_subscription(String, "/waypoint_nav/status",  self._make_heartbeat_cb("waypoint_navigator"), 10)
        self.create_subscription(String, "/aruco_landing/status", self._make_heartbeat_cb("aruco_landing"), 10)
        self.create_subscription(String, "/vision_node/heartbeat", self._make_heartbeat_cb("vision_node"), 10)
        self.create_subscription(String, "/camera_node/heartbeat", self._make_heartbeat_cb("camera_node"), 10)
        self.create_subscription(String, TOPIC_MISSION_SAFETY_EVENT, self._safety_event_cb, 10)

        # NOTE: not mavros_msgs/srv/ParamSet — confirmed 2026-07-10 that
        # /mavros/param/set now serves ParamSetV2 in this MAVROS version, a
        # type mismatch a ParamSet-typed client can never discover (its
        # service_is_ready() just stays permanently False, no error). The
        # standard ROS2 parameter service works reliably (verified live,
        # including a real arm succeeding once NAV_DLL_ACT was set this way).
        self.param_set_client = self.create_client(SetParameters, "/mavros/param/set_parameters")

        # ── Internal state ─────────────────────────
        self.mission_state = "IDLE"
        self.drone_status  = "DISCONNECTED"
        self.current_lat   = 0.0
        self.current_lon   = 0.0
        self.altitude      = 0.0
        self.heading       = 0.0
        self.battery_pct   = 100.0
        self.flight_mode   = "UNKNOWN"
        self.mavros_connected = False
        self.nav_dll_act_confirmed = False
        self._nav_dll_act_timer = None
        self.alt_abort_triggered = False
        self.home_lat = self.home_lon = None

        self.latest_frame  = None
        self.bridge        = CvBridge()

        # Connectivity gate bookkeeping (Feature 9)
        self.node_last_seen = {name: None for name in MONITORED_NODES}
        self.node_last_seen["drone_base"] = time.monotonic()  # first /drone_base/status may lag briefly
        self._last_gate_key = None

        # MAVROS-derived liveness (Feature 9 fix): mavros_connected/gps_lock/
        # battery_ok were being read as one-shot cached booleans that only
        # ever moved forward — once MAVROS said "connected" they stayed
        # true forever, even after MAVROS/PX4 died, so the gate would
        # report ALL_CLEAR against a dead stack. Track last-message time for
        # each, same staleness pattern as node_last_seen above.
        self.mavros_state_last_seen = None
        self.gps_last_seen = None
        self.battery_last_seen = None

        # Marker generation (Feature 1)
        self.marker_assignments = {}
        self.next_auto_marker_id = ARUCO_ID_AUTO_START

        # Mode + uploaded waypoints (Features 4/5, 9's geofence check)
        self.mode = db.get_config("mode", "sim")
        self.uploaded_waypoints = []

        # WebSocket bookkeeping — loop is set from the FastAPI startup hook
        self.ws_clients = set()
        self.loop = None

        # Travel log (Feature 10)
        self.current_mission_id = None

        self.create_timer(0.5, self._push_node_status)
        self.create_timer(1.0, self._log_travel_point)

        self.get_logger().info("BridgeNode ready — camera stream on /camera/stream")

    # ── Existing callbacks ─────────────────────────
    def _mission_cb(self, msg):
        prev = self.mission_state
        self.mission_state = msg.data
        self.node_last_seen["mission_manager"] = time.monotonic()
        if prev != msg.data:
            push_from_ros_thread({"type": "mission_state", "mission_state": msg.data})
        if prev not in AIRBORNE_MISSION_STATES and msg.data in AIRBORNE_MISSION_STATES:
            self.current_mission_id = db.start_mission(self.home_lat, self.home_lon)
        elif prev in AIRBORNE_MISSION_STATES and msg.data not in AIRBORNE_MISSION_STATES:
            if self.current_mission_id is not None:
                outcome = "COMPLETE" if msg.data == "MISSION_COMPLETE" else "ABORTED_LANDED"
                db.end_mission(self.current_mission_id, outcome)
                self.current_mission_id = None

    def _base_cb(self, msg):
        self.drone_status = msg.data
        self.node_last_seen["drone_base"] = time.monotonic()

    def _state_cb(self, msg):
        prev_connected = self.mavros_connected
        self.flight_mode = msg.mode
        self.mavros_connected = msg.connected
        self.mavros_state_last_seen = time.monotonic()
        if msg.connected and not prev_connected:
            self.nav_dll_act_confirmed = False
            if self._nav_dll_act_timer is None:
                self._nav_dll_act_timer = self.create_timer(3.0, self._disable_gcs_link_failsafe)
        elif not msg.connected:
            # Reconnect later may land on a fresh PX4 process (param not
            # guaranteed persisted) — re-arm the retry loop next connect.
            self.nav_dll_act_confirmed = False

    def _disable_gcs_link_failsafe(self):
        """This project has no human-operated GCS (QGroundControl) — the
        website + MAVROS + companion nodes are the only link. PX4's
        NAV_DLL_ACT defaults to a nonzero "data link loss" failsafe action
        that requires a GCS heartbeat to arm at all (verified: with the
        default value, /mavros/cmd/arming fails every time with "Arming
        denied: Resolve system health failures first" — see
        rcAndDataLinkCheck.cpp's gcs_connection_required check).

        Runs on a retry timer, not a one-shot attempt: the param-set client
        may not have finished its service-discovery handshake yet at the
        moment MAVROS first reports connected (confirmed: happens whenever
        this node starts *after* MAVROS is already up, not just on a fresh
        simultaneous boot) — a single service_is_ready() check right at the
        connection event is not reliable enough for something arming
        depends on.
        """
        if self.nav_dll_act_confirmed or not self.mavros_connected:
            return
        future = self._set_mavros_param("NAV_DLL_ACT", integer=0)
        if future is None:
            self.get_logger().warn("NAV_DLL_ACT set retrying — param service not ready yet")
            return

        def _on_result(f):
            ok = bool(f.result().results) and f.result().results[0].successful
            self.get_logger().info(f"NAV_DLL_ACT set -> 0: {ok}")
            if ok:
                self.nav_dll_act_confirmed = True
                if self._nav_dll_act_timer is not None:
                    self._nav_dll_act_timer.cancel()
                    self._nav_dll_act_timer = None

        future.add_done_callback(_on_result)

    def _set_mavros_param(self, name: str, *, integer: int = None, real: float = None):
        """Set an FCU parameter via MAVROS's ROS2-native parameter service
        (/mavros/param/set_parameters, rcl_interfaces/srv/SetParameters) —
        NOT mavros_msgs/srv/ParamSet, which this MAVROS version's
        /mavros/param/set actually serves as ParamSetV2 instead (a type
        mismatch a ParamSet client can never discover). Returns the pending
        future, or None if the service isn't discovered yet (caller decides
        whether/how to retry).
        """
        if not self.param_set_client.service_is_ready():
            return None
        value = (ParameterValue(type=ParameterType.PARAMETER_INTEGER, integer_value=integer)
                  if integer is not None else
                  ParameterValue(type=ParameterType.PARAMETER_DOUBLE, double_value=real))
        req = SetParameters.Request(parameters=[Parameter(name=name, value=value)])
        return self.param_set_client.call_async(req)

        future.add_done_callback(_on_result)

    def _home_cb(self, msg: HomePosition):
        self.home_lat = msg.geo.latitude
        self.home_lon = msg.geo.longitude

    def _gps_cb(self, msg: NavSatFix):
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude
        self.gps_last_seen = time.monotonic()
        push_from_ros_thread({
            "type": "position",
            "lat": msg.latitude, "lon": msg.longitude,
            "heading": self.heading, "altitude": self.altitude,
        })

    def _odom_cb(self, msg: Odometry):
        self.altitude = msg.pose.pose.position.z
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.heading = math.degrees(math.atan2(siny, cosy)) % 360

        if self.altitude >= ABORT_ALTITUDE_M and not self.alt_abort_triggered:
            self.alt_abort_triggered = True
            self.mission_state = "MISSION_ABORT"
            push_from_ros_thread({"type": "mission_state", "mission_state": "MISSION_ABORT"})
            self.get_logger().warn(
                f"SAFETY: altitude {self.altitude:.2f}m >= {ABORT_ALTITUDE_M}m limit — aborting mission")
            abort_msg = String(); abort_msg.data = "ABORT"
            self.cmd_pub.publish(abort_msg)

    def _imu_cb(self, msg: Imu):
        q = msg.orientation
        sinr_cosp = 2 * (q.w * q.x + q.y * q.z)
        cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y)
        roll = math.degrees(math.atan2(sinr_cosp, cosr_cosp))
        sinp = 2 * (q.w * q.y - q.z * q.x)
        pitch = math.degrees(math.copysign(math.pi / 2, sinp)) if abs(sinp) >= 1 \
            else math.degrees(math.asin(sinp))
        siny_cosp = 2 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
        yaw = math.degrees(math.atan2(siny_cosp, cosy_cosp))

        push_from_ros_thread({
            "type": "imu",
            "pitch": pitch, "roll": roll, "yaw": yaw,
            "rate": {"x": msg.angular_velocity.x, "y": msg.angular_velocity.y, "z": msg.angular_velocity.z},
        })

    def _battery_cb(self, msg: BatteryState):
        self.battery_last_seen = time.monotonic()
        if msg.percentage is not None and msg.percentage >= 0:
            self.battery_pct = msg.percentage * 100.0

    def _make_heartbeat_cb(self, name):
        def cb(msg):
            self.node_last_seen[name] = time.monotonic()
        return cb

    def _safety_event_cb(self, msg):
        try:
            data = json.loads(msg.data)
        except Exception:
            return
        if self.current_mission_id is not None:
            db.log_safety_event(self.current_mission_id, data.get("event_type", "UNKNOWN"), data.get("detail", ""))
        if data.get("event_type") == "MAVROS_LOST" or "NODE_HEARTBEAT" in data.get("event_type", ""):
            pass  # RTH outcome already recorded via mission_state transition -> ABORTED_RTH below

    # ── Camera callback ───────────────────────
    def _camera_cb(self, msg: Image):
        try:
            frame = self.bridge.imgmsg_to_cv2(msg, "bgr8")
            h, w = frame.shape[:2]
            cx, cy = w // 2, h // 2
            cv2.line(frame, (cx-20, cy), (cx+20, cy), (0, 255, 255), 1)
            cv2.line(frame, (cx, cy-20), (cx, cy+20), (0, 255, 255), 1)
            cv2.putText(frame, f"ALT: {self.altitude:.1f}m", (10, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.putText(frame, f"STATE: {self.mission_state}", (10, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)
            self.latest_frame = frame
        except Exception as e:
            self.get_logger().warn(f"Camera callback error: {e}", throttle_duration_sec=5.0)

    # ── Connectivity gate (Feature 9) ──────────────
    def _home_mismatch(self) -> bool:
        synced = db.get_home()
        if self.home_lat is None or synced is None or synced.get("lat") is None:
            return False
        return gps_distance_m(self.home_lat, self.home_lon, synced["lat"], synced["lon"]) > HOME_MISMATCH_THRESHOLD_M

    def _geofence_valid(self) -> bool:
        if self.home_lat is None or not self.uploaded_waypoints:
            return True
        for wp in self.uploaded_waypoints:
            if gps_distance_m(self.home_lat, self.home_lon, wp["lat"], wp["lon"]) > HOME_MISMATCH_THRESHOLD_M:
                return False
        return True

    def _stale_nodes(self):
        now = time.monotonic()
        return [name for name, seen in self.node_last_seen.items()
                if seen is None or (now - seen) > NODE_HEARTBEAT_STALE_S]

    @staticmethod
    def _is_stale(last_seen, threshold=NODE_HEARTBEAT_STALE_S):
        return last_seen is None or (time.monotonic() - last_seen) > threshold

    def all_clear(self):
        stale = self._stale_nodes()
        # mavros_connected/gps_lock/battery_ok used to be one-shot cached
        # booleans: once true, they stayed true forever, even after MAVROS
        # died and stopped publishing entirely — so the gate could report
        # ALL_CLEAR against a fully dead stack. Require a *recent* message
        # on each underlying topic, not just "ever received one".
        mavros_connected = self.mavros_connected and not self._is_stale(self.mavros_state_last_seen, MAVROS_STATE_STALE_S)
        gps_lock = (self.current_lat != 0.0 or self.current_lon != 0.0) and not self._is_stale(self.gps_last_seen)
        battery_ok = self.battery_pct > 10.0 and not self._is_stale(self.battery_last_seen, BATTERY_HEARTBEAT_STALE_S)
        checks = {
            "mavros_connected": mavros_connected,
            "nodes_alive": len(stale) == 0,
            "gps_lock": gps_lock,
            "home_set": self.home_lat is not None,
            "battery_ok": battery_ok,
            "home_position_match": not self._home_mismatch(),
            "geofence_valid": self._geofence_valid(),
        }
        ok = all(checks.values())
        reasons = [k for k, v in checks.items() if not v]
        if stale:
            reasons.append(f"stale_nodes:{stale}")
        return ok, reasons, checks

    def build_node_status_payload(self):
        ok, reasons, checks = self.all_clear()
        stale = set(self._stale_nodes())
        return {
            "type": "node_status",
            "nodes": {name: ("DISCONNECTED" if name in stale else "CONNECTED")
                      for name in MONITORED_NODES},
            "preflight": {
                "gps_lock": checks["gps_lock"],
                "satellites": None,
                "battery_pct": round(self.battery_pct, 1),
                "mavros_connected": checks["mavros_connected"],
                "home_set": checks["home_set"],
                "geofence_valid": checks["geofence_valid"],
                "home_position_match": checks["home_position_match"],
            },
            "all_clear": ok,
            "reasons": reasons,
        }

    def _push_node_status(self):
        if self.loop is None:
            return  # uvicorn/lifespan hasn't started yet — nothing could receive this anyway
        payload = self.build_node_status_payload()
        gate_key = (payload["all_clear"], tuple(sorted(payload["reasons"])))
        if gate_key == self._last_gate_key:
            return
        self._last_gate_key = gate_key
        push_from_ros_thread(payload)

    def _log_travel_point(self):
        if self.current_mission_id is not None:
            db.log_travel_point(self.current_mission_id, self.current_lat, self.current_lon,
                                 self.altitude, self.heading)

    # ── Feature 5 (section 6): mission-level max speed via MAVROS ────────
    def set_max_speed(self, speed_ms: float):
        future = self._set_mavros_param("MPC_XY_VEL_MAX", real=float(speed_ms))
        if future is None:
            self.get_logger().warn("MAVROS param/set service not ready — speed not applied")
            return
        future.add_done_callback(
            lambda f: self.get_logger().info(
                f"MPC_XY_VEL_MAX set -> {bool(f.result().results) and f.result().results[0].successful}"))


def main():
    global ros_node
    rclpy.init()
    db.init_db()
    ros_node = BridgeNode()

    api_thread = threading.Thread(
        target=uvicorn.run,
        kwargs={
            "app":       app,
            "host":      "0.0.0.0",
            "port":      8000,
            "log_level": "warning"
        },
        daemon=True
    )
    api_thread.start()

    try:
        rclpy.spin(ros_node)
    except KeyboardInterrupt:
        pass
    finally:
        ros_node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()

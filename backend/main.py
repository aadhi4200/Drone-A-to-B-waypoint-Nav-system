#!/usr/bin/env python3
"""
backend/main.py — add camera streaming to existing BridgeNode
"""
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from std_msgs.msg import String
from nav_msgs.msg import Odometry
from sensor_msgs.msg import NavSatFix, Image    # ← ADD Image
from mavros_msgs.msg import State
from cv_bridge import CvBridge                  # ← ADD
import cv2                                       # ← ADD
import numpy as np                              # ← ADD
import json, threading, uvicorn, asyncio

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",
                   "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ros_node = None

# ── Data models ───────────────────────────────────
class Waypoint(BaseModel):
    lat:   float
    lon:   float
    alt:   float = 5.0
    label: str   = "B"

class MissionUpload(BaseModel):
    waypoints: List[Waypoint]

# ── Existing endpoints ────────────────────────────
@app.post("/mission/upload")
def upload(mission: MissionUpload):
    if ros_node:
        data = [{"lat": w.lat, "lon": w.lon,
                 "alt": w.alt, "label": w.label}
                for w in mission.waypoints]
        msg = String(); msg.data = json.dumps(data)
        ros_node.waypoints_pub.publish(msg)
    return {"status": "ok", "count": len(mission.waypoints)}

@app.post("/mission/start")
def start():
    if ros_node:
        msg = String(); msg.data = "START"
        ros_node.cmd_pub.publish(msg)
    return {"status": "ok"}

@app.post("/mission/abort")
def abort():
    if ros_node:
        msg = String(); msg.data = "ABORT"
        ros_node.cmd_pub.publish(msg)
    return {"status": "ok"}

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

# ── NEW: Camera stream endpoint ───────────────────
@app.get("/camera/stream")
async def camera_stream():
    """
    MJPEG stream — React <img src="/camera/stream"> displays it live.
    No websocket needed — works like a regular image tag.
    """
    def generate_frames():
        while True:
            if ros_node is None or ros_node.latest_frame is None:
                # Send a black placeholder frame if no camera
                blank = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(
                    blank,
                    "Waiting for camera...",
                    (160, 240),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1.0,
                    (0, 200, 200),
                    2
                )
                _, buffer = cv2.imencode(".jpg", blank)
            else:
                # Encode latest ROS2 camera frame to JPEG
                _, buffer = cv2.imencode(
                    ".jpg",
                    ros_node.latest_frame,
                    [cv2.IMWRITE_JPEG_QUALITY, 80]
                )

            frame_bytes = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame_bytes +
                b"\r\n"
            )

            # ~30 FPS
            import time; time.sleep(0.033)

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

    return StreamingResponse(
        iter([buffer.tobytes()]),
        media_type="image/jpeg"
    )


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
        self.waypoints_pub = self.create_publisher(
            String, "/mission/waypoints", 10)
        self.cmd_pub = self.create_publisher(
            String, "/mission/command", 10)

        # ── Subscribers ───────────────────────────
        self.create_subscription(
            String,    "/mission/status",                 self._mission_cb, 10)
        self.create_subscription(
            String,    "/drone_base/status",              self._base_cb,    10)
        self.create_subscription(
            NavSatFix, "/mavros/global_position/global",  self._gps_cb,     sensor_qos)
        self.create_subscription(
            Odometry,  "/mavros/local_position/odom",     self._odom_cb,    sensor_qos)

        # ── NEW: Subscribe to downward camera ─────
        self.create_subscription(
            Image,
            "/camera/image_raw",        # ← your existing camera topic
            self._camera_cb,
            sensor_qos
        )

        from mavros_msgs.msg import State
        self.create_subscription(
            State, "/mavros/state", self._state_cb, sensor_qos)

        # ── Internal state ─────────────────────────
        self.mission_state = "IDLE"
        self.drone_status  = "DISCONNECTED"
        self.current_lat   = 0.0
        self.current_lon   = 0.0
        self.altitude      = 0.0
        self.heading       = 0.0
        self.battery_pct   = 100.0
        self.flight_mode   = "UNKNOWN"

        # ── NEW: Camera frame storage ──────────────
        self.latest_frame  = None   # numpy array (BGR)
        self.bridge        = CvBridge()

        self.get_logger().info("BridgeNode ready — camera stream on /camera/stream")

    # ── Existing callbacks ─────────────────────────
    def _mission_cb(self, msg): self.mission_state = msg.data
    def _base_cb(self,   msg): self.drone_status  = msg.data
    def _state_cb(self,  msg): self.flight_mode   = msg.mode

    def _gps_cb(self, msg: NavSatFix):
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude

    def _odom_cb(self, msg: Odometry):
        import math
        self.altitude = msg.pose.pose.position.z
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.heading = math.degrees(math.atan2(siny, cosy)) % 360

    # ── NEW: Camera callback ───────────────────────
    def _camera_cb(self, msg: Image):
        """
        Convert ROS2 Image → OpenCV BGR frame.
        Stored in self.latest_frame.
        FastAPI /camera/stream reads this 30x per second.
        """
        try:
            # Convert ROS2 image to OpenCV
            frame = self.bridge.imgmsg_to_cv2(msg, "bgr8")

            # Optional: draw ArUco overlay info on frame
            # Draw crosshair at center
            h, w = frame.shape[:2]
            cx, cy = w // 2, h // 2
            cv2.line(frame, (cx-20, cy), (cx+20, cy), (0, 255, 255), 1)
            cv2.line(frame, (cx, cy-20), (cx, cy+20), (0, 255, 255), 1)

            # Draw altitude overlay
            cv2.putText(
                frame,
                f"ALT: {self.altitude:.1f}m",
                (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6, (0, 255, 255), 1
            )

            # Draw mission state overlay
            cv2.putText(
                frame,
                f"STATE: {self.mission_state}",
                (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6, (0, 255, 0), 1
            )

            self.latest_frame = frame

        except Exception as e:
            self.get_logger().warn(
                f"Camera callback error: {e}",
                throttle_duration_sec=5.0)


def main():
    global ros_node
    rclpy.init()
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
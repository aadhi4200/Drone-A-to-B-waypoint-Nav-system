#!/usr/bin/env python3
"""
backend/main.py
FastAPI + ROS2 bridge node.
Connects React frontend to your ROS2 drone nodes.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from std_msgs.msg import String
from nav_msgs.msg import Odometry
from mavros_msgs.msg import HomePosition
from sensor_msgs.msg import NavSatFix        # real GPS lat/lon
import json, threading, uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",
                   "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ros_node = None

# ── FastAPI data models ────────────────────────────
class Waypoint(BaseModel):
    lat:   float
    lon:   float
    alt:   float = 5.0
    label: str   = "B"

class MissionUpload(BaseModel):
    waypoints: List[Waypoint]

# ── FastAPI endpoints ──────────────────────────────
@app.post("/mission/upload")
def upload(mission: MissionUpload):
    if ros_node:
        data = [{"lat": w.lat, "lon": w.lon,
                 "alt": w.alt, "label": w.label}
                for w in mission.waypoints]
        msg = String()
        msg.data = json.dumps(data)
        ros_node.waypoints_pub.publish(msg)
        ros_node.get_logger().info(
            f"Waypoints sent to ROS2: {data}")
    return {"status": "ok", "count": len(mission.waypoints)}

@app.post("/mission/start")
def start():
    if ros_node:
        msg = String()
        msg.data = "START"
        ros_node.cmd_pub.publish(msg)
        ros_node.get_logger().info("START command sent")
    return {"status": "ok"}

@app.post("/mission/abort")
def abort():
    if ros_node:
        msg = String()
        msg.data = "ABORT"
        ros_node.cmd_pub.publish(msg)
        ros_node.get_logger().info("ABORT command sent")
    return {"status": "ok"}

@app.get("/mission/status")
def status():
    if ros_node:
        return {
            "mission_state": ros_node.mission_state,
            "drone_status":  ros_node.drone_status,
            "lat":           ros_node.current_lat,   # ← real GPS
            "lon":           ros_node.current_lon,   # ← real GPS
            "altitude":      ros_node.altitude,      # ← real altitude
            "heading":       ros_node.heading,       # ← NEW
            "battery":       ros_node.battery_pct,   # ← NEW
            "flight_mode":   ros_node.flight_mode,   # ← NEW
        }
    return {"mission_state": "DISCONNECTED"}

# ── ROS2 Bridge Node ───────────────────────────────
class BridgeNode(Node):
    def __init__(self):
        super().__init__("mission_api_node")

        # ── QoS for MAVROS sensor topics ──────────
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )

        # ── Publishers ────────────────────────────
        # Send waypoints to WaypointNavigator
        self.waypoints_pub = self.create_publisher(
            String, "/mission/waypoints", 10)

        # Send START/ABORT to MissionManager
        self.cmd_pub = self.create_publisher(
            String, "/mission/command", 10)

        # ── Subscribers ───────────────────────────

        # Mission state from MissionManager
        self.create_subscription(
            String, "/mission/status",
            self._mission_cb, 10)

        # Drone status from DroneBase
        self.create_subscription(
            String, "/drone_base/status",
            self._base_cb, 10)

        # ── ADD THESE: Real GPS lat/lon from MAVROS ──
        self.create_subscription(
            NavSatFix,
            "/mavros/global_position/global",
            self._gps_cb,
            sensor_qos)           # ← BEST_EFFORT required

        # ── ADD THESE: Altitude + heading from odom ──
        self.create_subscription(
            Odometry,
            "/mavros/local_position/odom",
            self._odom_cb,
            sensor_qos)           # ← BEST_EFFORT required

        # ── ADD THESE: Battery from MAVROS ───────────
        from mavros_msgs.msg import BatteryStatus
        self.create_subscription(
            BatteryStatus,
            "/mavros/battery",
            self._battery_cb,
            sensor_qos)

        # ── ADD THESE: Flight mode from MAVROS ───────
        from mavros_msgs.msg import State
        self.create_subscription(
            State,
            "/mavros/state",
            self._state_cb,
            sensor_qos)

        # ── Internal state ─────────────────────────
        self.mission_state = "IDLE"
        self.drone_status  = "DISCONNECTED"

        # Real GPS from /mavros/global_position/global
        self.current_lat   = 0.0
        self.current_lon   = 0.0

        # Altitude from /mavros/local_position/odom
        self.altitude      = 0.0

        # Heading from /mavros/local_position/odom
        self.heading       = 0.0

        # Battery from /mavros/battery
        self.battery_pct   = 100.0

        # Flight mode from /mavros/state
        self.flight_mode   = "UNKNOWN"

        self.get_logger().info(
            "BridgeNode ready — FastAPI bridge active on port 8000")

    # ── Callbacks ─────────────────────────────────

    def _mission_cb(self, msg: String):
        self.mission_state = msg.data

    def _base_cb(self, msg: String):
        self.drone_status = msg.data

    def _gps_cb(self, msg: NavSatFix):
        """
        Real GPS coordinates from MAVROS.
        This is what gets sent to the React map.
        """
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude
        # Altitude above sea level (optional override)
        # self.altitude = msg.altitude

    def _odom_cb(self, msg: Odometry):
        """
        Local position odometry from MAVROS.
        z = altitude above home in metres.
        """
        import math
        self.altitude = msg.pose.pose.position.z

        # Extract yaw (heading) from quaternion
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.heading = math.degrees(math.atan2(siny, cosy)) % 360

    def _battery_cb(self, msg):
        """Battery percentage from MAVROS."""
        # percentage is 0.0-1.0, multiply by 100
        self.battery_pct = msg.percentage * 100

    def _state_cb(self, msg):
        """PX4 flight mode string."""
        self.flight_mode = msg.mode


def main():
    global ros_node
    rclpy.init()
    ros_node = BridgeNode()

    # FastAPI runs in background thread
    api_thread = threading.Thread(
        target=uvicorn.run,
        kwargs={
            "app":  app,
            "host": "0.0.0.0",
            "port": 8000,
            "log_level": "info"
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
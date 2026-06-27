# ROS 2 & FastAPI Ground Control Telemetry Bridge Specification

This document outlines the standard high-fidelity communication bridge enabling you to interface a physical or simulated **ROS 2 (Robot Operating System)** autonomous stack with this web telemetry application using a **FastAPI** Python application.

---

## 1. System Architecture

The architecture bridges the high-rate, low-level real-time pub/sub network of ROS 2 DDS (Data Distribution Service) with standard web-friendly WebSocket or JSON API streams.

```
+------------------------------------------------------------------------+
|                                  ROS 2 Network                         |
|  +-------------------+  /uav/state      +------------------------+     |
|  |   UAV ROS2 Node   | +--------------> |  FastAPI/rclpy Bridge  |     |
|  | (Sensors/Pixhawk)  | <--------------+ |  Integration Node      |     |
|  +-------------------+  /cmd_vel or     +-----------+------------+     |
|                         /gimbal                      |                 |
+------------------------------------------------------|-----------------+
                                                       |
                                               Server-Sent Events /
                                               SSE & JSON API (Port 8000)
                                                       v
                                          +------------+------------+
                                          | Human-Machine Interface |
                                          | (GCS Web Telemetry App) |
                                          +-------------------------+
```

---

## 2. Topic Trees & Interface Specs

### A. Telemetry Subscription (ROS 2 &rarr; FastAPI Server)
* **Topic Name:** `/uav/state`
* **Interface Type:** `sensor_msgs/msg/NavSatFix` paired with custom diagnostic structures or `geometry_msgs/msg/PoseStamped`

### B. Actuation & Flight Control Commands (FastAPI &rarr; ROS 2)
* **Topic Name:** `/cmd_vel` (or `/uav/cmd_vel`)
* **Interface Type:** `geometry_msgs/msg/Twist`
* **Topic Name:** `/gimbal/cmd_pitch`
* **Interface Type:** `std_msgs/msg/Float32`

---

## 3. Reference Implementation: `ros2_fastapi_bridge.py`

This standalone Python boilerplate sets up a secure, multi-threaded ROS 2 executor running natively alongside a FastAPI asynchronous web worker loop using `rclpy`.

```python
import sys
import threading
import asyncio
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ROS 2 Client Library for Python
try:
    import rclpy
    from rclpy.node import Node
    from rclpy.executors import MultiThreadedExecutor
    from geometry_msgs.msg import Twist, PoseStamped
    from std_msgs.msg import Float32
    from sensor_msgs.msg import NavSatFix
except ImportError:
    print("WARNING: ROS 2 rclpy client not detected on this machine.")
    print("Refer to Section 4 below to install ROS 2 on your targeting system.")

# FastAPI Setup
app = FastAPI(
    title="UAV Ground Control ROS 2 FastAPI Bridge",
    description="High-fidelity asynchronous telemetry proxy",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global memory cache holding current telemetry frames
telemetry_data_store: Dict[str, Any] = {
    "latitude": 9.965800,
    "longitude": 76.242100,
    "altitudeMeters": 45.2,
    "headingDegrees": 145.2,
    "pitchDegrees": 0.0,
    "rollDegrees": 0.0,
    "batteryPercentage": 98.5,
    "flightState": "DISARMED",
    "lidarDistanceMeters": 15.4
}

class CommandPayload(BaseModel):
    command: str
    target_heading: Optional[float] = None
    gimbal_tilt: Optional[float] = None


class ROS2BridgeNode(Node):
    """
    ROS 2 Bridge Node handling standard communication vectors
    """
    def __init__(self):
        super().__init__('fastapi_telemetry_bridge')
        
        # 1. ROS 2 Telemetry Subscribers
        self.nav_sub = self.create_subscription(
            NavSatFix,
            '/uav/gps',
            self.gps_callback,
            10
        )
        self.pose_sub = self.create_subscription(
            PoseStamped,
            '/uav/pose',
            self.pose_callback,
            10
        )
        
        # 2. ROS 2 Command Publishers
        self.cmd_vel_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.gimbal_pub = self.create_publisher(Float32, '/gimbal/cmd_pitch', 10)
        
        self.get_logger().info('✅ ROS 2 fastapi_telemetry_bridge Node Initialized Successful.')

    def gps_callback(self, msg: NavSatFix):
        """Standardized GPS sensor feed subscriber"""
        telemetry_data_store["latitude"] = msg.latitude
        telemetry_data_store["longitude"] = msg.longitude
        self.get_logger().debug(f"GPS Updated: Lat {msg.latitude:.6f}, Lng {msg.longitude:.6f}")

    def pose_callback(self, msg: PoseStamped):
        """UAV Odometry/Pose tracker callback"""
        telemetry_data_store["altitudeMeters"] = msg.pose.position.z
        
        # Convert quaternion orientation to Euler Angles (simplified pitch/roll indicators)
        q = msg.pose.orientation
        siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        heading_rad = -math.atan2(siny_cosp, cosy_cosp)
        telemetry_data_store["headingDegrees"] = (heading_rad * 180.0 / math.pi) % 360

    def trigger_gimbal_tilt(self, pitch_angle: float):
        """Publishes tilt command to servo nodes"""
        msg = Float32()
        msg.data = float(pitch_angle)
        self.gimbal_pub.publish(msg)
        self.get_logger().info(f"Published Gimbal Tilt command: {pitch_angle}°")

    def trigger_emergency_land(self):
        """Sends clean ZERO speed coordinates to start auto decelerating descent"""
        stop_msg = Twist()
        stop_msg.linear.x = 0.0
        stop_msg.linear.y = 0.0
        stop_msg.linear.z = -1.2 # steady auto-descent speed in m/s
        self.cmd_vel_pub.publish(stop_msg)
        self.get_logger().warn("⚠️ EMERGENCY LANDING MOTORS ARMED - /cmd_vel negative descent active.")


# Background thread executor for running the ROS 2 lifecycle worker
node_instance: Optional[ROS2BridgeNode] = None

def start_ros2_executor():
    global node_instance
    rclpy.init(args=None)
    node_instance = ROS2BridgeNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node_instance)
    try:
        executor.spin()
    except Exception as e:
        print(f"ROS 2 spinner execution stopped: {e}")
    finally:
        node_instance.destroy_node()
        rclpy.shutdown()


@app.on_event("startup")
def startup_event():
    """Starts ROS 2 worker thread on FastAPI boot"""
    if 'rclpy' in sys.modules:
        thread = threading.Thread(target=start_ros2_executor, daemon=True)
        thread.start()
        print("🚀 Started ROS 2 Telemetry Worker Thread.")
    else:
        print("⚠️ Running FastAPI in Mock/Offline mode. ROS 2 bindings skipped.")


@app.get("/api/telemetry")
def get_uav_telemetry():
    """Exposes current cached uav state to ground control interfaces"""
    return telemetry_data_store


@app.post("/api/command")
def send_uav_command(payload: CommandPayload):
    """Processes in-app operator actions to ROS 2 Topics"""
    global node_instance
    if not node_instance:
        raise HTTPException(status_code=503, detail="ROS 2 backend listener is offline")

    if payload.command == "EMERGENCY_LAND_IMMEDIATE":
        node_instance.trigger_emergency_land()
        telemetry_data_store["flightState"] = "EMERGENCY_LANDING"
        return {"status": "ARMED", "message": "Emergency descent command published to topic /cmd_vel"}
    
    if payload.gimbal_tilt is not None:
        node_instance.trigger_gimbal_tilt(payload.gimbal_tilt)
        return {"status": "GIMBAL_CMD_OK", "degrees": payload.gimbal_tilt}

    return {"status": "UNKNOWN_COMMAND"}


if __name__ == "__main__":
    import uvicorn
    # Execute development server
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 4. Install & Launch Instructions

To connect ROS 2 Humble smoothly to FastAPI:

### Step 1: Install Python Dependencies on your ROS 2 computer
```bash
pip install fastapi uvicorn pydantic
```

### Step 2: Source your ROS 2 Workspace
```bash
source /opt/ros/humble/setup.bash
# If using custom packages, source your colcon overlay as well
# source install/setup.bash
```

### Step 3: Launch your FastAPI Bridge
```bash
python3 src/ros2_fastapi_bridge.py
```

Now, your web control terminal interfaces directly with ROS 2 messages instantly on `localhost:8000`!

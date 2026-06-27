# UAV Telemetry MQTT Sensor Bridge Specification

This document provides a comprehensive blueprint to hook up your real UAV physical hardware (e.g., ESP32, Arduino, Raspberry Pi, or PyPilot) to subscribe and publish real-time telemetry datasets over MQTT (MQ Telemetry Transport) brokers like Mosquitto or HiveMQ.

---

## 1. Network Topology & Message Broker Configuration

The UAV drone communicates with the mission control room via a secure MQTT telemetry bridge:

```
            +-------------------------------------------+
            |  Physical UAV Drone (Sensors & Actuators)  |
            +---------------------+---------------------+
                                  |
                   Publish (WIFI / 4G LTE Connection)
                                  |
                                  v
                   +--------------+-------------+
                   |    MQTT Broker Interface   |
                   | (Mosquitto/HiveMQ/AWS IoT) |
                   +--------------+-------------+
                                  |
                        Subscribe / Forward
                                  |
                                  v
            +---------------------+---------------------+
            |     Telemetry Dashboard / Web Server     |
            +-------------------------------------------+
```

### Broker Connection Parameters
* **Default Port (Unsecured IP):** `1883`
* **Default Port (Secure TLS / SSL):** `8883`
* **WebSockets Connection Port:** `9001` or `443` (For direct browser subscription/forwarding support)
* **Encryption standard:** PKCS#12 client certificate handshake with TLS 1.3

---

## 2. Topic Trees & Message Schemas

### A. Telemetry Upload (UAV &rarr; Server Broker)
**Topic:** `uav/devices/{uavId}/telemetry`
**Method:** `PUBLISH` (Interval: 100ms - 500ms)

*JSON Payload Structure:*
```json
{
  "id": "UAV-2026-F98X2",
  "timestamp": "2026-06-18T10:15:20.124Z",
  "flightState": "EN_ROUTE",
  "latitude": 9.965800,
  "longitude": 76.242100,
  "altitudeMeters": 45.20,
  "headingDegrees": 145.2,
  "batteryPercentage": 89.4,
  "batteryTempCelsius": 28.5,
  "signalStrengthDbm": -62,
  "encryptionActive": true,
  "pitchDegrees": 1.25,
  "rollDegrees": -0.84,
  "yawDegrees": 145.2,
  "lidarDistanceMeters": 25.0,
  "obstacleAvoidanceActive": true,
  "emergencyLandingActive": false,
  "ambientTemperatureCelsius": 18.5,
  "climateHeaterActive": false,
  "climateCoolerActive": true,
  "windSpeedKnots": 12.4
}
```

### B. Command Receivers (Server &rarr; UAV Drone)
**Topic:** `uav/devices/{uavId}/commands`
**Method:** `SUBSCRIBE`

*Emergency Override Stop instruction:*
```json
{
  "command": "EMERGENCY_LAND_IMMEDIATE",
  "uavId": "UAV-2026-F98X2",
  "issuedBy": "OPERATOR_CHIEF_GCS",
  "timestamp": "2026-06-18T10:15:22.001Z"
}
```

---

## 3. Real Integration Code Snippets

### Option A: Python Sensor Bridge (using `paho-mqtt`)

Prerequisites:
```bash
pip install paho-mqtt
```

```python
import ssl
import time
import json
import random
import datetime
import paho.mqtt.client as mqtt

# Connection Configs
MQTT_BROKER = "broker.hivemq.com" # Replace with your active broker (e.g. AWS IoT, local Mosquitto)
MQTT_PORT = 1883
UAV_ID = "UAV-2026-F98X2"
PUBLISH_TOPIC = f"uav/devices/{UAV_ID}/telemetry"
COMMAND_TOPIC = f"uav/devices/{UAV_ID}/commands"

# Callback when MQTT connection completes
def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT Broker with result code: {rc}")
    # Subscribe to control commands
    client.subscribe(COMMAND_TOPIC)
    print(f"Subscribed to topic: {COMMAND_TOPIC}")

# Callback when a message command is received from ground control
def on_message(client, userdata, msg):
    try:
        command_payload = json.loads(msg.payload.decode('utf-8'))
        print(f"\n🚨 REMOTE COMMAND RECEIVED on topic {msg.topic}:")
        print(json.dumps(command_payload, indent=2))
        
        if command_payload.get("command") == "EMERGENCY_LAND_IMMEDIATE":
            print("🛑 WARNING: CRITICAL OVERRIDE INITIATED! Starting Immediate Emergency Landing Sequence...")
            # Trigger GPIO Pins or physical landing sequence here...
    except Exception as e:
        print(f"Error parsing incoming MQTT command: {e}")

# Setup Client
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

print(f"Connecting to MQTT Broker: {MQTT_BROKER}:{MQTT_PORT}...")
client.connect(MQTT_BROKER, MQTT_PORT, 60)

# Start background Thread to handle receiving network packages
client.loop_start()

# Simulate active telemetry publishing loop
try:
    print("Telemetry system active. Press Ctrl+C to stop simulation.")
    lat = 9.965800
    lng = 76.242100
    alt = 45.2
    battery = 100.0

    while True:
        # Simulate slight coordinate shift and battery drain
        lat += random.uniform(-0.0001, 0.0001)
        lng += random.uniform(-0.0001, 0.0001)
        alt = max(5.0, alt + random.uniform(-0.5, 0.5))
        battery = max(0.0, battery - 0.02)

        telemetry = {
            "id": UAV_ID,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "flightState": "EN_ROUTE",
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "altitudeMeters": round(alt, 2),
            "headingDegrees": 145.2,
            "batteryPercentage": round(battery, 1),
            "batteryTempCelsius": 28.5 + random.uniform(-0.2, 0.2),
            "signalStrengthDbm": random.randint(-68, -60),
            "encryptionActive": True,
            "pitchDegrees": round(random.uniform(-1.5, 1.5), 2),
            "rollDegrees": round(random.uniform(-1.0, 1.0), 2),
            "yawDegrees": 145.2,
            "lidarDistanceMeters": round(25.0 - random.uniform(0, 5), 1),
            "obstacleAvoidanceActive": True,
            "emergencyLandingActive": False,
            "ambientTemperatureCelsius": 18.5,
            "climateHeaterActive": False,
            "climateCoolerActive": True,
            "windSpeedKnots": 12.4
        }

        # Send JSON payload
        payload_str = json.dumps(telemetry)
        client.publish(PUBLISH_TOPIC, payload_str)
        print(f"Published Telemetry packet to {PUBLISH_TOPIC}")
        
        time.sleep(1.0) # Publish period: 1hz

except KeyboardInterrupt:
    print("UAV Bridge shut down.")
    client.loop_stop()
    client.disconnect()
```

---

### Option B: Node.js Telemetry Subscriber Bridge

Prerequisites:
```bash
npm install mqtt
```

```javascript
const mqtt = require('mqtt');

const CLIENT_ID = `subscriber_gcs_${Math.random().toString(16).substr(2, 8)}`;
const client = mqtt.connect('mqtt://broker.hivemq.com', {
  clientId: CLIENT_ID,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000,
});

const UAV_ID = "UAV-2026-F98X2";
const TELEMETRY_TOPIC = `uav/devices/${UAV_ID}/telemetry`;

client.on('connect', () => {
  console.log('✅ Ground Control Connection Established with Broker');
  
  // Subscribe to raw incoming telemetry
  client.subscribe([TELEMETRY_TOPIC], () => {
    console.log(`📡 Listening for live UAV Telemetry on topic: ${TELEMETRY_TOPIC}`);
  });
});

client.on('message', (topic, message) => {
  console.log(`\n----------------- INCOMING DATAFRAME: ${topic} -----------------`);
  try {
    const rawData = JSON.parse(message.toString());
    console.log(`[UAV_TIME] ${rawData.timestamp}`);
    console.log(`[STATUS]   STATE: ${rawData.flightState} | BATTERY: ${rawData.batteryPercentage}% | ALT: ${rawData.altitudeMeters}m`);
    console.log(`[GPS]      LAT: ${rawData.latitude} | LNG: ${rawData.longitude}`);
    console.log(`[IMU]      PITCH: ${rawData.pitchDegrees}° | ROLL: ${rawData.rollDegrees}° | HEADING: ${rawData.headingDegrees}°`);
  } catch (error) {
    console.log('Error parsing telemetry frame:', error.message);
  }
});
```

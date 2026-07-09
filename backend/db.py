"""
db.py — SQLite persistence for the travel log, system config (home sync,
sim/hardware mode), and the drone hardware profile.

SQLite (not the aspirational Postgres from the old POC doc) because this is
a single-drone, single-operator local system with no separate service to
run. One connection, one lock — write volume here is at most ~1-2 Hz.
"""
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/drone_ws2/travel_log.db")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db():
    global _conn
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    _conn.execute("PRAGMA journal_mode=WAL")
    with _lock:
        _conn.executescript("""
        CREATE TABLE IF NOT EXISTS missions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            outcome TEXT,
            home_lat REAL,
            home_lon REAL
        );
        CREATE TABLE IF NOT EXISTS travel_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            lat REAL, lon REAL, alt REAL, heading REAL
        );
        CREATE TABLE IF NOT EXISTS safety_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            detail TEXT
        );
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS drone_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            motor_kv REAL, esc_amp REAL, battery_mah REAL, cells INTEGER,
            num_motors INTEGER, auw_grams REAL, efficiency_factor REAL,
            cruise_speed_ms REAL
        );
        """)
        _conn.commit()


# ── system_config (home sync, sim/hardware mode) ──────────────────────────

def set_config(key: str, value) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO system_config(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)))
        _conn.commit()


def get_config(key: str, default=None):
    with _lock:
        row = _conn.execute("SELECT value FROM system_config WHERE key = ?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_home(lat: float, lon: float) -> None:
    set_config("home", {"lat": lat, "lon": lon, "synced_at": _now()})


def get_home():
    return get_config("home")


# ── drone_profile ─────────────────────────────────────────────────────────

def set_profile(profile: dict) -> None:
    fields = ["motor_kv", "esc_amp", "battery_mah", "cells", "num_motors",
              "auw_grams", "efficiency_factor", "cruise_speed_ms"]
    values = [profile.get(f) for f in fields]
    with _lock:
        _conn.execute(
            f"INSERT INTO drone_profile(id, {', '.join(fields)}) VALUES (1, {', '.join(['?']*len(fields))}) "
            f"ON CONFLICT(id) DO UPDATE SET " + ", ".join(f"{f} = excluded.{f}" for f in fields),
            values)
        _conn.commit()


def get_profile():
    with _lock:
        row = _conn.execute(
            "SELECT motor_kv, esc_amp, battery_mah, cells, num_motors, auw_grams, "
            "efficiency_factor, cruise_speed_ms FROM drone_profile WHERE id = 1").fetchone()
    if row is None:
        return None
    keys = ["motor_kv", "esc_amp", "battery_mah", "cells", "num_motors",
            "auw_grams", "efficiency_factor", "cruise_speed_ms"]
    return dict(zip(keys, row))


# ── missions / travel log ─────────────────────────────────────────────────

def start_mission(home_lat: float, home_lon: float) -> int:
    with _lock:
        cur = _conn.execute(
            "INSERT INTO missions(started_at, home_lat, home_lon) VALUES (?, ?, ?)",
            (_now(), home_lat, home_lon))
        _conn.commit()
        return cur.lastrowid


def end_mission(mission_id: int, outcome: str) -> None:
    with _lock:
        _conn.execute(
            "UPDATE missions SET ended_at = ?, outcome = ? WHERE id = ?",
            (_now(), outcome, mission_id))
        _conn.commit()


def log_travel_point(mission_id: int, lat: float, lon: float, alt: float, heading: float) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO travel_points(mission_id, timestamp, lat, lon, alt, heading) VALUES (?, ?, ?, ?, ?, ?)",
            (mission_id, _now(), lat, lon, alt, heading))
        _conn.commit()


def log_safety_event(mission_id: int, event_type: str, detail: str) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO safety_events(mission_id, timestamp, event_type, detail) VALUES (?, ?, ?, ?)",
            (mission_id, _now(), event_type, detail))
        _conn.commit()


def get_travel_log(mission_id: int) -> dict:
    with _lock:
        mission = _conn.execute(
            "SELECT id, started_at, ended_at, outcome, home_lat, home_lon FROM missions WHERE id = ?",
            (mission_id,)).fetchone()
        points = _conn.execute(
            "SELECT timestamp, lat, lon, alt, heading FROM travel_points "
            "WHERE mission_id = ? ORDER BY id", (mission_id,)).fetchall()
        events = _conn.execute(
            "SELECT timestamp, event_type, detail FROM safety_events "
            "WHERE mission_id = ? ORDER BY id", (mission_id,)).fetchall()
    if mission is None:
        return None
    return {
        "id": mission[0], "started_at": mission[1], "ended_at": mission[2],
        "outcome": mission[3], "home_lat": mission[4], "home_lon": mission[5],
        "path": [{"timestamp": p[0], "lat": p[1], "lon": p[2], "alt": p[3], "heading": p[4]} for p in points],
        "safety_events": [{"timestamp": e[0], "event_type": e[1], "detail": e[2]} for e in events],
    }

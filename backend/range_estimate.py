"""
range_estimate.py — honest, clearly-approximate flight-time/range estimator
from a drone hardware profile (Feature 11 / section 12).

KV/ESC-amp/battery-capacity alone don't determine flight time — actual draw
depends on all-up weight, prop, and aerodynamic efficiency too. This is a
rough estimate, not a guarantee; the API response says so explicitly.
"""

DEFAULT_EFFICIENCY_FACTOR = 22.0  # hover current (A) per kg AUW, rough default


def estimate(profile: dict) -> dict:
    """profile keys: battery_mah, cells, auw_grams, efficiency_factor
    (A per kg AUW; defaults to DEFAULT_EFFICIENCY_FACTOR if not set),
    cruise_speed_ms (defaults to 5.0 m/s if not set).
    Returns flight_time_min, range_m, nominal_voltage, hover_current_a — all
    labeled as approximations by the caller.
    """
    battery_mah = profile.get("battery_mah") or 0
    cells = profile.get("cells") or 0
    auw_kg = (profile.get("auw_grams") or 0) / 1000.0
    efficiency_factor = profile.get("efficiency_factor") or DEFAULT_EFFICIENCY_FACTOR
    cruise_speed_ms = profile.get("cruise_speed_ms") or 5.0

    if battery_mah <= 0 or cells <= 0 or auw_kg <= 0:
        return {
            "flight_time_min": None, "range_m": None,
            "nominal_voltage": None, "hover_current_a": None,
            "note": "Incomplete profile (need battery_mah, cells, auw_grams) — no estimate possible.",
        }

    nominal_voltage = cells * 3.7
    hover_current_a = auw_kg * efficiency_factor

    flight_time_min = (battery_mah / 1000.0) * 0.8 * 60.0 / hover_current_a
    range_m = flight_time_min * 60.0 * cruise_speed_ms * 0.5

    return {
        "flight_time_min": round(flight_time_min, 1),
        "range_m": round(range_m, 0),
        "nominal_voltage": round(nominal_voltage, 1),
        "hover_current_a": round(hover_current_a, 2),
        "note": "ESTIMATE ONLY — not guaranteed. Verify with bench/field testing before "
                "trusting this for mission planning.",
    }

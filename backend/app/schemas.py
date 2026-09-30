from typing import Optional
from pydantic import BaseModel, Field


class SeedObservationRequest(BaseModel):
    """Dev-only convenience for testing the whole stack before M6's live ingestion
    exists. Reuses M4's three illustrative scenarios by name, or accepts a fully
    custom scenario. NEVER wire this endpoint up in a real deployment — M6 replaces
    it with actual live data."""
    zone_id: str
    scenario_name: Optional[str] = Field(
        default=None,
        description="One of: 'typical_dry_midday', 'evening_rush_moderate_rain', "
                     "'northeast_monsoon_heavy_rain'. If omitted, supply custom_scenario instead.",
    )
    custom_scenario: Optional[dict] = Field(
        default=None,
        description="Full scenario dict matching M4's SCENARIOS shape if you don't want a preset.",
    )


class WhatIfRequest(BaseModel):
    """Scenario-simulation input. This is a hypothetical-condition comparison, not a
    causal claim — the response says so explicitly, per the original spec."""
    zone_id: str
    rainfall_rate_mm_per_h: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    wind_speed: Optional[float] = None
    pressure: Optional[float] = None
    aqi: Optional[float] = Field(default=None, description="Current-hour AQI reading to simulate from")
    pm2_5: Optional[float] = None
    pm10: Optional[float] = None

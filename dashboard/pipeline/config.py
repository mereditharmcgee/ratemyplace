"""Settings for the dashboard pipeline. Change a value here, re-run, and the published files follow."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("DASHBOARD_CACHE", os.path.join(HERE, ".cache"))
RAW = os.path.join(CACHE, "raw")
WORK = os.path.join(CACHE, "work")
OUT = os.environ.get("DASHBOARD_OUT", os.path.join(HERE, "..", "web", "public", "data"))

# The one switch for owner names.
#   "ordinance": an individual or family trust that owns and lives in a building of 6 or fewer
#                units is published as "Individual owner" and the name never leaves the pipeline.
#                This follows Docket #1958, 9-1.3(H)(4)(ii).
#   "all":       every owner of record is published by name.
OWNER_NAME_POLICY = os.environ.get("DASHBOARD_OWNER_NAME_POLICY", "ordinance")
INDIVIDUAL_OWNER_LABEL = "Individual owner"
WITHHELD_OWNER_LABEL = "Owner name not shown"

WINDOW_START = "2023-01-01"

# Analyze Boston resource ids
RES = {
    "assessment_fy2026": "ee73430d-96c0-423e-ad21-c4cfb54c8961",
    "sam_addresses": "6d6cfc99-6f26-4974-bbb3-17b5dbad49a9",
    "isd_violations": "800a2663-1d6a-46e7-9356-bedb70f5332c",
    "rentsmart": "dc615ff7-2ff3-416a-922b-f0f334f085d0",
    "pwd_enforcement": "90ed3816-5e70-443c-803d-9a71f44470be",
    "str_eligibility": "83621b97-9a00-4aa7-bf43-28cae04969d4",
    "council_districts": "2d9092dd-5175-49ab-9b18-0c0efcef4153",
    "bpda_neighborhoods": "e5849875-a6f6-4c9c-9d8a-5048b0fbd03e",
    "311_new_system": "254adca6-64ab-4c5c-9fc0-a6da622be185",
}
RES_311_YEARLY = {
    2023: "e6013a93-1321-4f2a-bf91-8d8a02f1e62f",
    2024: "dff4d804-5031-443a-8409-8344efd0e5c8",
    2025: "9d7c2214-4709-478a-a2e8-fb2020a5bb94",
    2026: "1a0b420d-99f1-4887-9851-990b2a5a6e17",
}
PACKAGES = {"council_districts": "city-council-districts-2023-2032", "bpda_neighborhoods": "bpda-neighborhood-boundaries"}

# Public dataset pages, shown next to every number
SOURCES = {
    "311": {"name": "311 Service Requests", "url": "https://data.boston.gov/dataset/311-service-requests"},
    "rentsmart": {"name": "RentSmart", "url": "https://data.boston.gov/dataset/rentsmart"},
    "isd": {"name": "Building and Property Violations", "url": "https://data.boston.gov/dataset/building-and-property-violations1"},
    "pwd": {"name": "Public Works Violations", "url": "https://data.boston.gov/dataset/public-works-violations"},
    "assessment": {"name": "Property Assessment", "url": "https://data.boston.gov/dataset/property-assessment"},
    "str": {"name": "Short-Term Rental Eligibility", "url": "https://data.boston.gov/dataset/short-term-rental-eligibility"},
    "districts": {"name": "City Council Districts (2023-2032)", "url": "https://data.boston.gov/dataset/city-council-districts-2023-2032"},
    "neighborhoods": {"name": "BPDA Neighborhood Boundaries", "url": "https://data.boston.gov/dataset/bpda-neighborhood-boundaries"},
    "sam": {"name": "Live Street Address Management (SAM) Addresses", "url": "https://data.boston.gov/dataset/live-street-address-management-sam-addresses"},
}

# New 311 system (from Nov 5, 2026): service name -> the method's bucket. A service that is not listed
# here is left out and counted in meta.unmapped_new_311 so a new name is noticed rather than guessed at.
NEW_311_BUCKETS = {
    "unsatisfactory living conditions": "living_conditions",
    "pest infestation - residential": "pests_interior",
    "insufficient heat": "heat",
    "unsatisfactory utilities - (electrical, plumbing) - residential": "utilities",
    "no utilities (electrical, gas, water)": "utilities",
    "cross metering": "utilities",
    "sewage/septic back-up": "utilities",
    "rat activity": "rodent_activity_isd",
}

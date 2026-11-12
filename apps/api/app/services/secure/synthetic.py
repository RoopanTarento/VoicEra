"""Synthetic demo contacts. Never use real customer data in demos.

Numbers are generated in valid Indian mobile format from a fixed seed, so they
may coincide with real subscribers. That is why every upload made from this
generator should be marked ``synthetic`` — the secure gateway refuses to dial
synthetic contacts through any provider except the mock one.

The file deliberately includes duplicates (exact and differently formatted)
and invalid rows so the validation step has something to show.
"""

from __future__ import annotations

import csv
import io
import random

FIRST_NAMES = (
    "Arun", "Priya", "Rahul", "Ananya", "Vikram", "Lakshmi", "Suresh", "Divya", "Karthik", "Meena",
    "Rohit", "Sneha", "Imran", "Fatima", "Joseph", "Mary", "Harpreet", "Gurpreet", "Ravi", "Kavya",
    "Sanjay", "Pooja", "Deepak", "Nisha", "Arjun", "Shalini", "Manoj", "Rekha", "Naveen", "Aisha",
)
LAST_NAMES = (
    "Kumar", "Sharma", "Iyer", "Reddy", "Nair", "Patel", "Singh", "Das", "Gupta", "Menon",
    "Rao", "Khan", "Joshi", "Pillai", "Verma", "Mehta", "Bose", "Naidu", "Chopra", "Thomas",
)
DISTRICTS = ("Pune", "Nashik", "Nagpur", "Mysuru", "Kochi", "Madurai", "Guntur", "Indore", "Patna", "Ludhiana")
SCHEMES = ("PM-KISAN", "Ayushman Bharat", "PMAY-G", "Ujjwala", "e-Shram")


def _mobile(rng: random.Random) -> str:
    first = rng.choice("6789")
    rest = "".join(rng.choice("0123456789") for _ in range(9))
    return f"+91{first}{rest}"


def generate_rows(count: int = 100, *, seed: int = 20261109) -> list[dict[str, str]]:
    """``count`` data rows including 4 duplicates and 3 invalid rows."""
    rng = random.Random(seed)
    unique = max(1, count - 7)
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    while len(rows) < unique:
        number = _mobile(rng)
        if number in seen:
            continue
        seen.add(number)
        rows.append(
            {
                "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
                "phone_number": number,
                "district": rng.choice(DISTRICTS),
                "scheme": rng.choice(SCHEMES),
            }
        )
    # Duplicates: two exact copies and two reformatted copies of earlier rows.
    for idx, style in ((3, "exact"), (11, "exact"), (20, "spaced"), (42, "national")):
        src = dict(rows[min(idx, len(rows) - 1)])
        n = src["phone_number"]
        if style == "spaced":
            src["phone_number"] = f"+91 {n[3:8]} {n[8:]}"
        elif style == "national":
            src["phone_number"] = f"0{n[3:]}"
        rows.append(src)
    rows.append({"name": "Short Number", "phone_number": "+91 98765", "district": "Pune", "scheme": "e-Shram"})
    rows.append({"name": "Letters Only", "phone_number": "call-me-later", "district": "Kochi", "scheme": "PMAY-G"})
    rows.append({"name": "Missing Number", "phone_number": "", "district": "Patna", "scheme": "Ujjwala"})
    rng.shuffle(rows)
    return rows[:count] if count >= 7 else rows[:count]


def generate_csv(count: int = 100, *, seed: int = 20261109) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=["name", "phone_number", "district", "scheme"])
    writer.writeheader()
    writer.writerows(generate_rows(count, seed=seed))
    return buffer.getvalue()

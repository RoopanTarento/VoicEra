"""Campaign analysis over a period: totals, a calendar of days, hours and campaigns.

Answers "what did our campaigns do on this day / in this month / this year /
between these dates", in the organisation's local time (India by default).
Everything is counted from call records, so a campaign appears on every day it
placed calls, not only the day it started.

A period is two local dates, inclusive. Call times are stored in UTC ISO
format, so the local day boundaries are converted to UTC for the query and
each call is placed back on its local day.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.database import get_database
from app.services.call_analysis import OUTCOMES

DEFAULT_TZ = "Asia/Kolkata"
MAX_DAYS = 400  # a calendar year plus room for a custom range across a year end
MAX_CALLS = 200_000  # beyond this the period is summarised from the first calls only


class InsightsError(ValueError):
    pass


class _FixedZone(tzinfo):
    """India and UTC without a time zone database (slim container images may
    not ship one); neither has daylight saving, so a fixed offset is exact."""

    def __init__(self, key: str, offset: timedelta) -> None:
        self.key = key
        self._offset = offset

    def utcoffset(self, dt: datetime | None) -> timedelta:
        return self._offset

    def dst(self, dt: datetime | None) -> timedelta:
        return timedelta(0)

    def tzname(self, dt: datetime | None) -> str:
        return self.key


_FIXED = {"Asia/Kolkata": timedelta(hours=5, minutes=30), "UTC": timedelta(0)}


def zone(tz: str | None) -> tzinfo:
    name = tz or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        if name in _FIXED:
            return _FixedZone(name, _FIXED[name])
        raise InsightsError(f"Unknown time zone: {tz}") from exc


def parse_period(date_from: str, date_to: str) -> tuple[date, date]:
    try:
        start, end = date.fromisoformat(date_from), date.fromisoformat(date_to)
    except ValueError as exc:
        raise InsightsError("Dates must look like 2026-11-11.") from exc
    if end < start:
        raise InsightsError("The end date is before the start date.")
    if (end - start).days + 1 > MAX_DAYS:
        raise InsightsError(f"Pick a period of at most {MAX_DAYS} days.")
    return start, end


def utc_bounds(start: date, end: date, tz: tzinfo) -> tuple[str, str]:
    """UTC ISO strings for local midnight at ``start`` and the midnight after ``end``."""
    lo = datetime.combine(start, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return lo.isoformat(), hi.isoformat()


def _local(created_at: Any, tz: tzinfo) -> datetime | None:
    if isinstance(created_at, datetime):
        moment = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    else:
        try:
            moment = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        except ValueError:
            return None
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz)


def call_query(org_id: str, start: date, end: date, tz: tzinfo, *, campaign_id: str | None = None,
               agent_id: str | None = None) -> dict[str, Any]:
    lo, hi = utc_bounds(start, end, tz)
    query: dict[str, Any] = {"org_id": org_id, "created_at": {"$gte": lo, "$lt": hi}}
    query["campaign_id"] = campaign_id if campaign_id else {"$nin": [None, ""]}
    if agent_id:
        query["agent_id"] = agent_id
    return query


def _rate(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def period(
    org_id: str,
    date_from: str,
    date_to: str,
    *,
    tz: str | None = None,
    campaign_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    zone_info = zone(tz)
    start, end = parse_period(date_from, date_to)
    db = get_database()
    projection = {"_id": 0, "campaign_id": 1, "created_at": 1, "call_response": 1, "duration": 1,
                  "analysis.outcome": 1, "analysis.issues": 1, "analysis.switched_to": 1}
    calls = list(
        db["CallLogs"].find(call_query(org_id, start, end, zone_info, campaign_id=campaign_id, agent_id=agent_id),
                            projection).limit(MAX_CALLS + 1)
    )
    truncated = len(calls) > MAX_CALLS
    calls = calls[:MAX_CALLS]

    campaigns = {
        c["campaign_id"]: c
        for c in db["Campaigns"].find({"org_id": org_id}, {"_id": 0, "campaign_id": 1, "name": 1, "state": 1, "agent_id": 1})
    }

    def name_of(cid: str) -> str:
        return str((campaigns.get(cid) or {}).get("name") or "Deleted campaign")

    outcomes: Counter[str] = Counter()
    issues: Counter[str] = Counter()
    days: dict[str, dict[str, Any]] = {}
    day_campaigns: dict[str, Counter[str]] = defaultdict(Counter)
    hours = [{"hour": h, "calls": 0, "answered": 0} for h in range(24)]
    per: dict[str, dict[str, Any]] = {}
    durations: list[float] = []
    answered_total = switched = issue_calls = 0

    for call in calls:
        moment = _local(call.get("created_at"), zone_info)
        if moment is None:
            continue
        day = moment.date().isoformat()
        cid = str(call.get("campaign_id"))
        answered = call.get("call_response") == "answered"
        analysis = call.get("analysis") or {}
        outcome = analysis.get("outcome")

        entry = days.setdefault(day, {"date": day, "calls": 0, "answered": 0})
        entry["calls"] += 1
        entry["answered"] += int(answered)
        day_campaigns[day][cid] += 1
        hours[moment.hour]["calls"] += 1
        hours[moment.hour]["answered"] += int(answered)

        row = per.setdefault(cid, {"calls": 0, "answered": 0, "issues": 0, "outcomes": Counter(), "days": set(),
                                   "first": moment, "last": moment, "durations": []})
        row["calls"] += 1
        row["answered"] += int(answered)
        row["days"].add(day)
        row["first"], row["last"] = min(row["first"], moment), max(row["last"], moment)
        if outcome:
            outcomes[outcome] += 1
            row["outcomes"][outcome] += 1
        if outcome == "issue_reported":
            issue_calls += 1
            row["issues"] += 1
            issues.update(analysis.get("issues") or [])
        if analysis.get("switched_to"):
            switched += 1
        if answered:
            answered_total += 1
            if call.get("duration"):
                durations.append(float(call["duration"]))
                row["durations"].append(float(call["duration"]))

    total = sum(r["calls"] for r in per.values())
    interested = outcomes.get("interested", 0) + outcomes.get("will_apply", 0)
    campaign_rows = []
    for cid, r in per.items():
        top = r["outcomes"].most_common(1)
        info = campaigns.get(cid) or {}
        campaign_rows.append({
            "campaign_id": cid,
            "name": name_of(cid),
            "state": info.get("state"),
            "agent_id": info.get("agent_id"),
            "calls": r["calls"],
            "answered": r["answered"],
            "answer_rate": _rate(r["answered"], r["calls"]),
            "issues_reported": r["issues"],
            "avg_duration_seconds": round(sum(r["durations"]) / len(r["durations"]), 1) if r["durations"] else None,
            "top_outcome": {"key": top[0][0], "label": OUTCOMES.get(top[0][0], top[0][0]), "calls": top[0][1]} if top else None,
            "days_active": len(r["days"]),
            "first_call": r["first"].isoformat(),
            "last_call": r["last"].isoformat(),
        })
    campaign_rows.sort(key=lambda r: (-r["calls"], r["name"].casefold()))

    day_rows = []
    for day in sorted(days):
        d = days[day]
        day_rows.append({
            **d,
            "answer_rate": _rate(d["answered"], d["calls"]),
            "campaigns": [{"campaign_id": cid, "name": name_of(cid), "calls": n}
                          for cid, n in day_campaigns[day].most_common()],
        })

    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "tz": zone_info.key,
        "totals": {
            "campaigns": len(per),
            "calls": total,
            "answered": answered_total,
            "answer_rate": _rate(answered_total, total),
            "avg_duration_seconds": round(sum(durations) / len(durations), 1) if durations else None,
            "talk_minutes": round(sum(durations) / 60, 1),
            "interested": interested,
            "issues_reported": issue_calls,
            "switched_path": switched,
            "days_active": len(days),
        },
        "outcomes": [{"key": k, "label": OUTCOMES.get(k, k), "count": n} for k, n in outcomes.most_common()],
        "issues": [{"theme": t, "calls": n} for t, n in issues.most_common()],
        "days": day_rows,
        "hours": hours,
        "campaigns": campaign_rows,
        "truncated": truncated,
    }

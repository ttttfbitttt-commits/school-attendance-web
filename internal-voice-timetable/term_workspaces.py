"""Independent term workspaces stored inside one school's project payload."""
from __future__ import annotations

import copy
import datetime
import uuid


META_KEYS = {"termWorkspaces", "activeTermId", "termVersion"}
TERM_LABELS = {"الأول": "الفصل الأول", "الثاني": "الفصل الثاني", "الثالث": "الفصل الثالث"}


def snapshot(project: dict) -> dict:
    """Take a deep copy of the active term without nested term history."""
    return copy.deepcopy({key: value for key, value in project.items() if key not in META_KEYS})


def ensure(project: dict) -> dict:
    """Migrate a legacy one-term project in memory without changing its data."""
    if project.get("termWorkspaces") and project.get("activeTermId"):
        return project
    term = project.get("school", {}).get("term", "الأول") or "الأول"
    workspace_id = "term-" + uuid.uuid4().hex
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    project["termVersion"] = 1
    project["activeTermId"] = workspace_id
    project["termWorkspaces"] = [{
        "id": workspace_id,
        "term": term,
        "label": TERM_LABELS.get(term, f"الفصل الدراسي {term}"),
        "createdAt": now,
        "updatedAt": now,
        "snapshot": snapshot(project),
    }]
    return project


def refresh_active(project: dict) -> dict:
    """Store the current active workspace before persisting the project."""
    ensure(project)
    active_id = project["activeTermId"]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    active = next((item for item in project["termWorkspaces"] if item.get("id") == active_id), None)
    if active is None:
        raise ValueError("لم يُعثر على مساحة الفصل الدراسي النشطة.")
    active["term"] = project.get("school", {}).get("term", active.get("term", "الأول"))
    active["label"] = TERM_LABELS.get(active["term"], f"الفصل الدراسي {active['term']}")
    active["updatedAt"] = now
    active["snapshot"] = snapshot(project)
    return project


def create_next(project: dict, term: str) -> dict:
    ensure(project)
    term = str(term or "").strip()
    if term not in TERM_LABELS:
        raise ValueError("اختر الفصل الدراسي الأول أو الثاني أو الثالث.")
    if any(item.get("term") == term for item in project["termWorkspaces"]):
        raise ValueError(f"{TERM_LABELS[term]} موجود بالفعل. افتحه من قائمة الفصول الدراسية.")
    refresh_active(project)
    source = snapshot(project)
    source.setdefault("school", {})["term"] = term
    # Keep school setup, teacher roster, numbers, workload limits, courses and timing.
    # Attendance, signing links and generated schedules belong only to the source term.
    for key in ["placements", "referencePlacements", "locks", "savedSchedules", "absenceRecords", "signatureTasks", "standby", "activeScheduleId", "activeScheduleName", "solverHint", "exceptions", "manualOverrideMode"]:
        source.pop(key, None)
    source["placements"] = []
    source["referencePlacements"] = []
    source["locks"] = []
    source["setupStep"] = min(max(int(source.get("setupStep", 0)), 4), 5)
    workspace_id = "term-" + uuid.uuid4().hex
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    workspaces = copy.deepcopy(project["termWorkspaces"])
    workspaces.append({"id": workspace_id, "term": term, "label": TERM_LABELS[term], "createdAt": now, "updatedAt": now, "snapshot": copy.deepcopy(source)})
    next_project = copy.deepcopy(source)
    next_project["termVersion"] = 1
    next_project["activeTermId"] = workspace_id
    next_project["termWorkspaces"] = workspaces
    next_project["revision"] = project.get("revision", 0) + 1
    refresh_active(next_project)
    return next_project


def switch(project: dict, workspace_id: str) -> dict:
    ensure(project)
    refresh_active(project)
    target = next((item for item in project["termWorkspaces"] if item.get("id") == workspace_id), None)
    if target is None:
        raise ValueError("الفصل الدراسي المطلوب غير موجود.")
    if workspace_id == project["activeTermId"]:
        return project
    next_project = copy.deepcopy(target.get("snapshot") or {})
    if not next_project:
        raise ValueError("تعذر فتح بيانات الفصل الدراسي.")
    next_project["termVersion"] = 1
    next_project["activeTermId"] = workspace_id
    next_project["termWorkspaces"] = copy.deepcopy(project["termWorkspaces"])
    next_project["revision"] = project.get("revision", 0) + 1
    refresh_active(next_project)
    return next_project


def public_list(project: dict) -> list[dict]:
    ensure(project)
    active_id = project["activeTermId"]
    return [{key: item.get(key) for key in ("id", "term", "label", "createdAt", "updatedAt")} | {"active": item.get("id") == active_id} for item in project["termWorkspaces"]]

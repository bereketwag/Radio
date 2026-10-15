"""Minimal environment helper: loads .env (if present) into os.environ."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path | None = None) -> None:
    if path is None:
        # Prefer backend/.env, but the repo ships .env at the project root
        # (one file shared by docker compose and the local dev server).
        candidates = [BASE_DIR / ".env", BASE_DIR.parent / ".env"]
        for candidate in candidates:
            if candidate.exists():
                path = candidate
                break
        else:
            return
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Real environment variables always win over .env values.
        os.environ.setdefault(key, value)


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default

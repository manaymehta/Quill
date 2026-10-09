"""Gemini calls with the agent's retry rules (architecture plan §2.1, D27).

- 503 "high demand" (Gemini briefly overloaded): up to 2 quick retries,
  ~1 s then ~3 s, only while the deadline allows.
- 429 "quota exceeded" (our key's per-minute limit is used up): Google says
  how long to wait (`retryDelay`). Wait once, only if that fits before the
  deadline; otherwise raise QuotaExceeded so the caller can tell the user.
- Anything else is raised unchanged.

Calls go through the async client, so cancelling the awaiting task (Stop, the
turn's time ceiling) aborts the HTTP request to Google itself.
"""
import asyncio
import math
import re
import time
from typing import Any

from google import genai
from google.genai import errors as genai_errors

OVERLOAD_RETRY_DELAYS = (1.0, 3.0)
# A retry is only worth starting if the call itself still has this long.
MIN_CALL_SECONDS = 3.0
# Used when a 429 doesn't say how long to wait.
DEFAULT_QUOTA_WAIT_SECONDS = 60.0

_RETRY_DELAY_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)s\s*$")


class QuotaExceeded(Exception):
    """The API key's request quota is used up for longer than the turn can wait."""

    def __init__(self, retry_after_seconds: int):
        super().__init__(f"Gemini quota exceeded; retry in ~{retry_after_seconds}s")
        self.retry_after_seconds = retry_after_seconds


class CallDeadlineExceeded(Exception):
    """The deadline passed before the model answered."""


def quota_retry_delay(exc: genai_errors.APIError) -> float:
    """Read Google's `retryDelay` ("40s") out of a 429's error details."""
    details = exc.details if isinstance(exc.details, dict) else {}
    error = details.get("error", details)
    items = error.get("details", []) if isinstance(error, dict) else []
    for item in items or []:
        if isinstance(item, dict) and "retryDelay" in item:
            match = _RETRY_DELAY_RE.match(str(item["retryDelay"]))
            if match:
                return float(match.group(1))
    return DEFAULT_QUOTA_WAIT_SECONDS


async def generate_with_retries(
    client: genai.Client, *, deadline: float, **kwargs: Any
) -> Any:
    """`client.aio.models.generate_content(**kwargs)`, bounded by `deadline`
    (a `time.monotonic()` value), with the retry rules above."""
    overload_retries = 0
    quota_retried = False

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CallDeadlineExceeded()
        try:
            return await asyncio.wait_for(
                client.aio.models.generate_content(**kwargs), timeout=remaining
            )
        except TimeoutError:
            raise CallDeadlineExceeded() from None
        except genai_errors.APIError as exc:
            if exc.code == 503 and overload_retries < len(OVERLOAD_RETRY_DELAYS):
                wait = OVERLOAD_RETRY_DELAYS[overload_retries]
                overload_retries += 1
                if deadline - time.monotonic() >= wait + MIN_CALL_SECONDS:
                    print(f"Gemini 503 (high demand); retrying in {wait:.0f}s")
                    await asyncio.sleep(wait)
                    continue
                raise
            if exc.code == 429:
                wait = quota_retry_delay(exc)
                if not quota_retried and deadline - time.monotonic() >= wait + MIN_CALL_SECONDS:
                    quota_retried = True
                    print(f"Gemini 429 (quota); waiting {wait:.0f}s as Google asked")
                    await asyncio.sleep(wait)
                    continue
                raise QuotaExceeded(max(1, math.ceil(wait))) from exc
            raise

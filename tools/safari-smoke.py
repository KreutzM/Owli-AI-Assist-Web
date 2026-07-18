#!/usr/bin/env python3
"""Run a narrow, non-sensitive Safari smoke against approved Owli staging targets."""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

WEBDRIVER_URL = "http://127.0.0.1:4444"
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
PNG_FIXTURE = (
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOs2HKHgYGBiYGBgYGBAQAYJgIMiYqd0gAAAABJRU5ErkJggg=="
)
PAGES_HOST = re.compile(r"^[a-z0-9-]+\.owli-ai-assist-web\.pages\.dev$")


class WebDriverError(RuntimeError):
    """Raised when SafariDriver returns a WebDriver protocol error."""


class SafariDriver:
    def __init__(self, endpoint: str = WEBDRIVER_URL) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.session_id: str | None = None

    def start(self) -> None:
        response = self._request(
            "POST",
            "/session",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "safari",
                        "safari:automaticInspection": False,
                        "safari:automaticProfiling": False,
                    }
                }
            },
        )
        value = response.get("value")
        if not isinstance(value, dict) or not isinstance(value.get("sessionId"), str):
            raise WebDriverError(f"Unexpected Safari session response: {response}")
        self.session_id = value["sessionId"]

    def quit(self) -> None:
        if not self.session_id:
            return
        try:
            self._request("DELETE", f"/session/{self.session_id}")
        finally:
            self.session_id = None

    def navigate(self, url: str) -> None:
        self._session_request("POST", "/url", {"url": url})

    def execute(self, script: str, args: list[Any] | None = None) -> Any:
        response = self._session_request(
            "POST",
            "/execute/sync",
            {"script": script, "args": args or []},
        )
        return response.get("value")

    def find_css(self, selector: str) -> str:
        response = self._session_request(
            "POST",
            "/element",
            {"using": "css selector", "value": selector},
        )
        value = response.get("value")
        if not isinstance(value, dict) or not isinstance(value.get(ELEMENT_KEY), str):
            raise WebDriverError(f"Element not found: {selector}")
        return value[ELEMENT_KEY]

    def send_file(self, selector: str, file_path: Path) -> None:
        element_id = self.find_css(selector)
        text = str(file_path.resolve())
        self._session_request(
            "POST",
            f"/element/{element_id}/value",
            {"text": text, "value": list(text)},
        )

    def screenshot(self, destination: Path) -> None:
        response = self._session_request("GET", "/screenshot")
        value = response.get("value")
        if isinstance(value, str):
            destination.write_bytes(base64.b64decode(value))

    def _session_request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.session_id:
            raise WebDriverError("Safari session is not active.")
        return self._request(method, f"/session/{self.session_id}{path}", payload)

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.endpoint}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json;charset=UTF-8"},
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raw = error.read()
            raise WebDriverError(
                f"SafariDriver HTTP {error.code}: {raw.decode('utf-8', 'replace')}"
            ) from error
        parsed = json.loads(raw or b"{}")
        value = parsed.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise WebDriverError(
                f"{value.get('error')}: {value.get('message', 'WebDriver command failed')}"
            )
        return parsed


def validate_target(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    allowed_host = host == "assist-staging.owli-ai.com" or bool(PAGES_HOST.fullmatch(host))
    if (
        parsed.scheme != "https"
        or not allowed_host
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"Unsupported Safari smoke target: {url}")
    return url.rstrip("/")


def create_jpeg_fixture(source_png: Path, output: Path, width: int, height: int) -> None:
    subprocess.run(
        [
            "sips",
            "-z",
            str(height),
            str(width),
            "-s",
            "format",
            "jpeg",
            str(source_png),
            "--out",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"Fixture was not created: {output}")


def wait_until(
    probe: Callable[[], Any],
    predicate: Callable[[Any], bool],
    description: str,
    timeout: float = 60,
) -> Any:
    deadline = time.monotonic() + timeout
    last_value: Any = None
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            last_value = probe()
            if predicate(last_value):
                return last_value
            last_error = None
        except Exception as error:  # noqa: BLE001 - retain the last diagnostic
            last_error = error
        time.sleep(0.5)
    diagnostic = f"; last error: {last_error}" if last_error else f"; last value: {last_value}"
    raise TimeoutError(f"Timed out waiting for {description}{diagnostic}")


def page_snapshot(driver: SafariDriver) -> dict[str, Any]:
    value = driver.execute(
        """
        const camera = [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === 'Rückkamera öffnen');
        const file = document.querySelector('#scene-file');
        return {
          readyState: document.readyState,
          cameraPresent: Boolean(camera),
          cameraDisabled: camera ? camera.disabled : null,
          filePresent: Boolean(file),
          fileDisabled: file ? file.disabled : null,
          hasManifest: Boolean(document.querySelector('link[rel="manifest"]')),
          bodyText: document.body?.innerText ?? ''
        };
        """
    )
    if not isinstance(value, dict):
        raise WebDriverError(f"Unexpected page snapshot: {value}")
    return value


def click_button(driver: SafariDriver, label: str) -> None:
    clicked = driver.execute(
        """
        const label = arguments[0];
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.trim() === label);
        if (!button || button.disabled) return false;
        button.click();
        return true;
        """,
        [label],
    )
    if clicked is not True:
        raise WebDriverError(f"Enabled button was not found: {label}")


def storage_snapshot(driver: SafariDriver) -> dict[str, Any]:
    value = driver.execute(
        """
        return {
          localStorageLength: localStorage.length,
          sessionStorageLength: sessionStorage.length,
          cookieLength: document.cookie.length,
          search: location.search,
          hash: location.hash
        };
        """
    )
    if not isinstance(value, dict):
        raise WebDriverError(f"Unexpected storage snapshot: {value}")
    return value


def run_smoke(target_url: str, artifacts: Path) -> dict[str, Any]:
    artifacts.mkdir(parents=True, exist_ok=True)
    driver = SafariDriver()
    checks: dict[str, str] = {}

    with tempfile.TemporaryDirectory(prefix="owli-safari-fixtures-") as temp_dir:
        fixture_dir = Path(temp_dir)
        source_png = fixture_dir / "source.png"
        jpeg_12mp = fixture_dir / "iphone-12mp.jpg"
        jpeg_24mp = fixture_dir / "iphone-24mp.jpg"
        source_png.write_bytes(base64.b64decode(PNG_FIXTURE))
        create_jpeg_fixture(source_png, jpeg_12mp, width=4000, height=3000)
        create_jpeg_fixture(source_png, jpeg_24mp, width=6000, height=4000)

        try:
            driver.start()
            driver.navigate(target_url)

            readiness = wait_until(
                lambda: page_snapshot(driver),
                lambda snapshot: (
                    snapshot.get("readyState") == "complete"
                    and snapshot.get("cameraPresent") is True
                    and snapshot.get("cameraDisabled") is False
                    and snapshot.get("filePresent") is True
                    and snapshot.get("fileDisabled") is False
                ),
                "remote readiness controls",
                timeout=90,
            )
            if readiness.get("hasManifest") is not True:
                raise AssertionError("Manifest link is missing.")
            checks["readiness"] = "PASS"

            driver.send_file("#scene-file", jpeg_12mp)
            wait_until(
                lambda: page_snapshot(driver),
                lambda snapshot: (
                    "Normalisiertes JPEG:" in str(snapshot.get("bodyText", ""))
                    and "Szene beschreiben" in str(snapshot.get("bodyText", ""))
                ),
                "12 MP JPEG normalization",
                timeout=90,
            )
            checks["jpeg12mp"] = "PASS"

            click_button(driver, "Bild verwerfen")
            wait_until(
                lambda: page_snapshot(driver),
                lambda snapshot: "Normalisiertes JPEG:" not in str(snapshot.get("bodyText", "")),
                "prepared-image reset",
            )

            driver.send_file("#scene-file", jpeg_24mp)
            wait_until(
                lambda: page_snapshot(driver),
                lambda snapshot: (
                    "Das Bild überschreitet die lokalen Abmessungsgrenzen."
                    in str(snapshot.get("bodyText", ""))
                ),
                "specific 24 MP dimensions rejection",
                timeout=60,
            )
            checks["jpeg24mpBoundary"] = "PASS"

            storage = storage_snapshot(driver)
            expected_empty = (
                storage.get("localStorageLength") == 0
                and storage.get("sessionStorageLength") == 0
                and storage.get("cookieLength") == 0
                and storage.get("search") == ""
                and storage.get("hash") == ""
            )
            if not expected_empty:
                raise AssertionError(f"Unexpected browser persistence: {storage}")
            checks["privacy"] = "PASS"

            return {
                "targetUrl": target_url,
                "checks": checks,
                "fixtureMetadata": {
                    "jpeg12mp": {
                        "width": 4000,
                        "height": 3000,
                        "bytes": jpeg_12mp.stat().st_size,
                    },
                    "jpeg24mp": {
                        "width": 6000,
                        "height": 4000,
                        "bytes": jpeg_24mp.stat().st_size,
                    },
                },
            }
        except Exception:
            try:
                driver.screenshot(artifacts / "failure.png")
            except Exception:  # noqa: BLE001 - best-effort diagnostic only
                pass
            raise
        finally:
            driver.quit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()

    target_url = validate_target(args.target_url)
    result_path = args.artifacts / "result.json"
    try:
        result = run_smoke(target_url, args.artifacts)
    except Exception as error:  # noqa: BLE001 - emit a safe top-level failure report
        failure = {
            "targetUrl": target_url,
            "status": "FAIL",
            "errorType": type(error).__name__,
            "error": str(error),
        }
        args.artifacts.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        return 1

    success = {"status": "PASS", **result}
    result_path.write_text(json.dumps(success, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(success, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

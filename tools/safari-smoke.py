#!/usr/bin/env python3
"""Run the narrow Safari smoke and its bounded local HTTPS readiness probe."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

WEBDRIVER_URL = "http://127.0.0.1:4444"
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
PAGES_HOST = re.compile(r"^[a-z0-9-]+\.owli-ai-assist-web\.pages\.dev$")
REMOTE_NETWORK_ERRNOS = {51, 54, 60, 61, 65, 101, 104, 110, 111, 113}


class WebDriverError(RuntimeError):
    """Raised when SafariDriver returns a WebDriver protocol error."""


class RemoteReadinessUnavailable(RuntimeError):
    """Raised only when a direct approved-target HTTPS preflight cannot connect."""

    def __init__(self, message: str, *, error_type: str) -> None:
        super().__init__(message)
        self.error_type = error_type


class SafariDriver:
    def __init__(
        self,
        endpoint: str = WEBDRIVER_URL,
        *,
        accept_insecure_certs: bool = False,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.accept_insecure_certs = accept_insecure_certs
        self.session_id: str | None = None

    def start(self) -> None:
        always_match: dict[str, Any] = {
            "browserName": "safari",
            "safari:automaticInspection": False,
            "safari:automaticProfiling": False,
        }
        if self.accept_insecure_certs:
            always_match["acceptInsecureCerts"] = True
        payload = {"capabilities": {"alwaysMatch": always_match}}
        for attempt in range(2):
            try:
                response = self._request("POST", "/session", payload)
                value = response.get("value")
                if not isinstance(value, dict) or not isinstance(value.get("sessionId"), str):
                    raise WebDriverError(f"Unexpected Safari session response: {response}")
                self.session_id = value["sessionId"]
                return
            except WebDriverError as error:
                session_launch_timeout = (
                    "session not created" in str(error).lower()
                    and "timed out while connecting to a safari instance" in str(error).lower()
                )
                if attempt or not session_launch_timeout:
                    raise
                time.sleep(3)

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
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
    ):
        raise ValueError(f"Unsupported Safari smoke target: {url}")
    return url.rstrip("/")


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


def wait_for_local_https(
    url: str,
    server_pid: int,
    server_log: Path,
    *,
    timeout: float = 90,
    poll_interval: float = 1,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    probe: Callable[[str], None] | None = None,
    process_alive: Callable[[int], bool] | None = None,
    log_reader: Callable[[Path], str] | None = None,
) -> None:
    """Wait for the real HTTPS endpoint, while failing fast if its process exits."""
    if timeout <= 0:
        raise ValueError("Local HTTPS readiness timeout must be positive.")

    def default_probe(target: str) -> None:
        request = urllib.request.Request(target, method="GET")
        context = ssl._create_unverified_context()  # noqa: SLF001 - loopback test certificate
        with urllib.request.urlopen(request, timeout=2, context=context) as response:
            if response.status >= 400:
                raise RuntimeError(f"Local HTTPS endpoint returned HTTP {response.status}.")

    def default_process_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        return True

    read_log = log_reader or (lambda path: path.read_text(encoding="utf-8", errors="replace"))
    check_process = process_alive or default_process_alive
    check_endpoint = probe or default_probe
    started = clock()
    deadline = started + timeout
    last_error: BaseException | None = None

    while True:
        if not check_process(server_pid):
            log = read_log(server_log)
            raise RuntimeError(
                "Local HTTPS server exited before readiness.\n"
                f"--- local HTTPS server log ---\n{log}"
            )
        try:
            check_endpoint(url)
            return
        except Exception as error:  # noqa: BLE001 - retain the last endpoint diagnostic
            last_error = error

        now = clock()
        if now >= deadline:
            elapsed = now - started
            log = read_log(server_log)
            raise TimeoutError(
                f"Timed out after {elapsed:.1f}s waiting for local HTTPS endpoint {url}; "
                f"last probe error: {type(last_error).__name__}: {last_error}.\n"
                f"--- local HTTPS server log ---\n{log}"
            )
        sleep(min(poll_interval, max(0, deadline - now)))


def is_direct_remote_transport_error(error: BaseException) -> bool:
    """Classify only typed network failures from the approved-target HTTPS preflight."""
    candidate: BaseException | object = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(candidate, (ConnectionRefusedError, ConnectionResetError, socket.gaierror, socket.timeout)):
        return True
    return isinstance(candidate, OSError) and candidate.errno in REMOTE_NETWORK_ERRNOS


def preflight_remote_https(
    target_url: str,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
    timeout: float = 10,
) -> None:
    """Verify direct HTTPS transport before any SafariDriver command is issued."""
    request = urllib.request.Request(target_url, method="GET")
    try:
        with opener(request, timeout=timeout) as response:
            response.read(1)
    except urllib.error.HTTPError:
        # An HTTP response proves transport reachability. Browser/application checks decide validity.
        return
    except Exception as error:
        if is_direct_remote_transport_error(error):
            reason = error.reason if isinstance(error, urllib.error.URLError) else error
            raise RemoteReadinessUnavailable(
                str(reason),
                error_type=type(reason).__name__,
            ) from error
        raise


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


def wait_for_remote_readiness(driver: SafariDriver) -> dict[str, Any]:
    return wait_until(
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


def run_smoke(
    target_url: str,
    artifacts: Path,
    *,
    preflight: Callable[[str], None] | None = None,
    driver_factory: Callable[[], SafariDriver] = SafariDriver,
) -> dict[str, Any]:
    artifacts.mkdir(parents=True, exist_ok=True)
    (preflight or preflight_remote_https)(target_url)
    driver = driver_factory()
    checks: dict[str, str] = {}

    try:
        driver.start()
        driver.navigate(target_url)
        readiness = wait_for_remote_readiness(driver)

        if readiness.get("hasManifest") is not True:
            raise AssertionError("Manifest link is missing.")
        checks["readiness"] = "PASS"

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

        return {"targetUrl": target_url, "checks": checks}
    except Exception:
        try:
            driver.screenshot(artifacts / "failure.png")
        except Exception:  # noqa: BLE001 - best-effort diagnostic only
            pass
        raise
    finally:
        driver.quit()


def write_result(path: Path, result: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-url")
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--allow-inconclusive-remote-readiness", action="store_true")
    parser.add_argument("--wait-for-local-https", action="store_true")
    parser.add_argument("--server-pid", type=int)
    parser.add_argument("--server-log", type=Path)
    parser.add_argument("--readiness-timeout", type=float, default=90)
    args = parser.parse_args()

    if args.wait_for_local_https:
        if not args.target_url or args.server_pid is None or args.server_log is None:
            parser.error(
                "--wait-for-local-https requires --target-url, --server-pid, and --server-log"
            )
        try:
            wait_for_local_https(
                args.target_url,
                args.server_pid,
                args.server_log,
                timeout=args.readiness_timeout,
            )
        except Exception as error:  # noqa: BLE001 - workflow-facing diagnostic
            print(f"{type(error).__name__}: {error}")
            return 1
        print(f"Local HTTPS endpoint is ready: {args.target_url}")
        return 0

    if not args.target_url or args.artifacts is None:
        parser.error("Safari smoke requires --target-url and --artifacts")

    target_url = validate_target(args.target_url)
    result_path = args.artifacts / "result.json"
    try:
        result = run_smoke(target_url, args.artifacts)
    except RemoteReadinessUnavailable as error:
        inconclusive = {
            "targetUrl": target_url,
            "status": "INCONCLUSIVE_REMOTE_READINESS",
            "reason": str(error),
            "errorType": error.error_type,
        }
        write_result(result_path, inconclusive)
        return 0 if args.allow_inconclusive_remote_readiness else 1
    except Exception as error:  # noqa: BLE001 - emit a safe top-level failure report
        failure = {
            "targetUrl": target_url,
            "status": "FAIL",
            "errorType": type(error).__name__,
            "error": str(error),
        }
        write_result(result_path, failure)
        return 1

    write_result(result_path, {"status": "PASS", **result})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

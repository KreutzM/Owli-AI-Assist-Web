#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import socket
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("safari_smoke", ROOT / "tools/safari-smoke.py")
assert SPEC and SPEC.loader
safari_smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(safari_smoke)


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += seconds


class LocalHttpsReadinessTests(unittest.TestCase):
    def test_ready_after_more_than_30_seconds_before_deadline(self) -> None:
        clock = FakeClock()
        attempts = 0

        def probe(_url: str) -> None:
            nonlocal attempts
            attempts += 1
            if clock.value < 32:
                raise ConnectionRefusedError("not ready")

        safari_smoke.wait_for_local_https(
            "https://127.0.0.1:4180/",
            123,
            Path("server.log"),
            timeout=90,
            clock=clock,
            sleep=clock.sleep,
            probe=probe,
            process_alive=lambda _pid: True,
            log_reader=lambda _path: "available after 32 seconds",
        )
        self.assertGreater(clock.value, 30)
        self.assertLess(clock.value, 90)
        self.assertGreater(attempts, 30)

    def test_successful_response_is_accepted(self) -> None:
        clock = FakeClock()
        safari_smoke.wait_for_local_https(
            "https://127.0.0.1:4180/",
            123,
            Path("server.log"),
            timeout=90,
            clock=clock,
            sleep=clock.sleep,
            probe=lambda _url: None,
            process_alive=lambda _pid: True,
            log_reader=lambda _path: "ready",
        )
        self.assertEqual(clock.value, 0)

    def test_http_404_is_not_accepted_as_readiness(self) -> None:
        clock = FakeClock()

        def probe(url: str) -> None:
            error = urllib.error.HTTPError(url, 404, "Not Found", {}, None)
            try:
                raise error
            finally:
                error.close()

        with self.assertRaisesRegex(TimeoutError, "HTTP Error 404"):
            safari_smoke.wait_for_local_https(
                "https://127.0.0.1:4180/",
                123,
                Path("server.log"),
                timeout=2,
                clock=clock,
                sleep=clock.sleep,
                probe=probe,
                process_alive=lambda _pid: True,
                log_reader=lambda _path: "server running with wrong root",
            )

    def test_server_exit_before_readiness_includes_log(self) -> None:
        clock = FakeClock()
        states = iter([True, False])
        with self.assertRaisesRegex(RuntimeError, "exited before readiness") as caught:
            safari_smoke.wait_for_local_https(
                "https://127.0.0.1:4180/",
                123,
                Path("server.log"),
                timeout=90,
                clock=clock,
                sleep=clock.sleep,
                probe=lambda _url: (_ for _ in ()).throw(ConnectionRefusedError()),
                process_alive=lambda _pid: next(states),
                log_reader=lambda _path: "fatal startup error",
            )
        self.assertIn("fatal startup error", str(caught.exception))

    def test_bounded_timeout_includes_log_and_reason(self) -> None:
        clock = FakeClock()
        with self.assertRaisesRegex(TimeoutError, "Timed out after 5.0s") as caught:
            safari_smoke.wait_for_local_https(
                "https://127.0.0.1:4180/",
                123,
                Path("server.log"),
                timeout=5,
                clock=clock,
                sleep=clock.sleep,
                probe=lambda _url: (_ for _ in ()).throw(ConnectionRefusedError("no listener")),
                process_alive=lambda _pid: True,
                log_reader=lambda _path: "server still starting",
            )
        self.assertIn("server still starting", str(caught.exception))
        self.assertIn("ConnectionRefusedError", str(caught.exception))


class RemoteReadinessRetryTests(unittest.TestCase):
    def unavailable_snapshot(self) -> dict[str, object]:
        return {
            "readyState": "complete",
            "cameraPresent": False,
            "cameraDisabled": None,
            "filePresent": False,
            "fileDisabled": None,
            "retryPresent": True,
            "retryDisabled": False,
            "hasManifest": True,
            "bodyText": safari_smoke.REMOTE_READINESS_RETRY_MESSAGE,
        }

    def ready_snapshot(self) -> dict[str, object]:
        return {
            "readyState": "complete",
            "cameraPresent": True,
            "cameraDisabled": False,
            "filePresent": True,
            "fileDisabled": False,
            "retryPresent": False,
            "retryDisabled": None,
            "hasManifest": True,
            "bodyText": "ready",
        }

    def test_explicit_retry_can_recover_within_same_deadline(self) -> None:
        clock = FakeClock()
        snapshots = iter(
            [
                self.unavailable_snapshot(),
                {**self.unavailable_snapshot(), "bodyText": "Sichere Sitzung wird vorbereitet"},
                self.ready_snapshot(),
            ]
        )
        retry_count = 0

        def retry_action(_driver: object) -> bool:
            nonlocal retry_count
            retry_count += 1
            return True

        result = safari_smoke.wait_for_remote_readiness(
            object(),
            timeout=5,
            clock=clock,
            sleep=clock.sleep,
            snapshot_probe=lambda _driver: next(snapshots),
            retry_action=retry_action,
        )

        self.assertTrue(safari_smoke.remote_readiness_complete(result))
        self.assertEqual(retry_count, 1)
        self.assertLess(clock.value, 5)

    def test_persistent_application_unavailability_remains_hard(self) -> None:
        clock = FakeClock()
        retry_count = 0

        def retry_action(_driver: object) -> bool:
            nonlocal retry_count
            retry_count += 1
            return True

        with self.assertRaisesRegex(TimeoutError, "retry attempted: True"):
            safari_smoke.wait_for_remote_readiness(
                object(),
                timeout=2,
                clock=clock,
                sleep=clock.sleep,
                snapshot_probe=lambda _driver: self.unavailable_snapshot(),
                retry_action=retry_action,
            )

        self.assertEqual(retry_count, 1)

    def test_other_substantive_readiness_failure_is_not_retried(self) -> None:
        clock = FakeClock()
        retry_count = 0
        snapshot = {
            **self.unavailable_snapshot(),
            "bodyText": "Die Szenenbeschreibung ist in dieser Bereitstellung nicht freigegeben.",
        }

        def retry_action(_driver: object) -> bool:
            nonlocal retry_count
            retry_count += 1
            return True

        with self.assertRaisesRegex(TimeoutError, "retry attempted: False"):
            safari_smoke.wait_for_remote_readiness(
                object(),
                timeout=1,
                clock=clock,
                sleep=clock.sleep,
                snapshot_probe=lambda _driver: snapshot,
                retry_action=retry_action,
            )

        self.assertEqual(retry_count, 0)


class FakeResponse:
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _size: int) -> bytes:
        return b"x"


class FakeDriver:
    def __init__(
        self,
        *,
        start_error: Exception | None = None,
        navigate_error: Exception | None = None,
    ) -> None:
        self.start_error = start_error
        self.navigate_error = navigate_error
        self.started = False

    def start(self) -> None:
        self.started = True
        if self.start_error:
            raise self.start_error

    def navigate(self, _url: str) -> None:
        if self.navigate_error:
            raise self.navigate_error

    def execute(self, _script: str, _args: list[object] | None = None) -> object:
        return {}

    def screenshot(self, _destination: Path) -> None:
        return None

    def quit(self) -> None:
        return None


class RemoteClassificationTests(unittest.TestCase):
    target = "https://deadbeef.owli-ai-assist-web.pages.dev"

    def run_main_with_preflight_error(self, allow: bool) -> tuple[int, dict[str, object]]:
        with tempfile.TemporaryDirectory() as directory:
            argv = [
                "safari-smoke.py",
                "--target-url",
                self.target,
                "--artifacts",
                directory,
            ]
            if allow:
                argv.append("--allow-inconclusive-remote-readiness")
            with mock.patch.object(
                safari_smoke,
                "preflight_remote_https",
                side_effect=safari_smoke.RemoteReadinessUnavailable(
                    "Connection refused", error_type="ConnectionRefusedError"
                ),
            ), mock.patch("sys.argv", argv):
                status = safari_smoke.main()
            result = json.loads((Path(directory) / "result.json").read_text())
        return status, result

    def test_direct_connection_refusal_allow_flag_is_inconclusive(self) -> None:
        status, result = self.run_main_with_preflight_error(True)
        self.assertEqual(status, 0)
        self.assertEqual(result["status"], "INCONCLUSIVE_REMOTE_READINESS")
        self.assertEqual(result["errorType"], "ConnectionRefusedError")
        self.assertIn("Connection refused", result["reason"])

    def test_direct_connection_refusal_without_allow_flag_fails(self) -> None:
        status, result = self.run_main_with_preflight_error(False)
        self.assertEqual(status, 1)
        self.assertEqual(result["status"], "INCONCLUSIVE_REMOTE_READINESS")

    def test_direct_preflight_classifies_typed_network_error(self) -> None:
        def opener(*_args: object, **_kwargs: object) -> object:
            raise urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))

        with self.assertRaises(safari_smoke.RemoteReadinessUnavailable) as caught:
            safari_smoke.preflight_remote_https(self.target, opener=opener)
        self.assertEqual(caught.exception.error_type, "ConnectionRefusedError")

    def test_local_safaridriver_connection_refusal_is_hard(self) -> None:
        driver = FakeDriver(start_error=urllib.error.URLError(ConnectionRefusedError(61, "refused")))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(urllib.error.URLError):
                safari_smoke.run_smoke(
                    self.target,
                    Path(directory),
                    preflight=lambda _url: None,
                    driver_factory=lambda: driver,
                )
        self.assertTrue(driver.started)

    def test_webdriver_timeout_is_hard(self) -> None:
        error = safari_smoke.WebDriverError("timeout: page load command timed out")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(safari_smoke.WebDriverError):
                safari_smoke.run_smoke(
                    self.target,
                    Path(directory),
                    preflight=lambda _url: None,
                    driver_factory=lambda: FakeDriver(navigate_error=error),
                )

    def test_reachable_substantive_failure_is_hard(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(
                safari_smoke,
                "wait_for_remote_readiness",
                return_value={"hasManifest": True},
            ), mock.patch.object(
                safari_smoke,
                "storage_snapshot",
                return_value={
                    "localStorageLength": 1,
                    "sessionStorageLength": 0,
                    "cookieLength": 0,
                    "search": "",
                    "hash": "",
                },
            ):
                with self.assertRaisesRegex(AssertionError, "Unexpected browser persistence"):
                    safari_smoke.run_smoke(
                        self.target,
                        Path(directory),
                        preflight=lambda _url: None,
                        driver_factory=FakeDriver,
                    )

    def test_http_error_proves_transport_reachable(self) -> None:
        def opener(*_args: object, **_kwargs: object) -> object:
            error = urllib.error.HTTPError(self.target, 503, "Unavailable", {}, None)
            try:
                raise error
            finally:
                error.close()

        safari_smoke.preflight_remote_https(self.target, opener=opener)

    def test_generic_webdriver_timeout_text_is_not_transport(self) -> None:
        self.assertFalse(
            safari_smoke.is_direct_remote_transport_error(
                safari_smoke.WebDriverError("timed out waiting for page load")
            )
        )


class WorkflowPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = (ROOT / ".github/workflows/apple-smoke.yml").read_text()
        self.web_ci = (ROOT / ".github/workflows/ci.yml").read_text()

    def step(self, name: str) -> str:
        step = self.workflow.split(f"- name: {name}", 1)[1]
        return step.split("- name:", 1)[0]

    def web_ci_step(self, name: str) -> str:
        step = self.web_ci.split(f"- name: {name}", 1)[1]
        return step.split("- name:", 1)[0]

    def test_focused_python_tests_are_mandatory(self) -> None:
        step = self.step("Run focused Safari smoke tests")
        self.assertIn("python3 tools/safari-smoke.test.py", step)
        self.assertNotIn("continue-on-error", step)
        self.assertNotIn("if:", step)

    def test_workflow_serves_actual_harness_root(self) -> None:
        step = self.step("Start local HTTPS harness")
        self.assertIn("tools/serve-built-web.mjs", step)
        self.assertIn("--root tests/harness/safari-jpeg/dist", step)
        self.assertIn("--target-url https://127.0.0.1:4180/", step)

    def test_full_linux_checks_headers_from_actual_harness_root(self) -> None:
        step = self.web_ci_step("Build deterministic Safari JPEG harness")
        headers = "tests/harness/safari-jpeg/dist/_headers"
        self.assertIn(f"test -f {headers}", step)
        self.assertIn("grep -qE", step)
        self.assertIn(headers, step)
        self.assertNotIn(
            "grep -qE 'api-staging\\.owli-ai\\.com|https://api\\.owli-ai\\.com' dist/_headers",
            step,
        )

    def test_remote_readiness_requires_successful_mandatory_local_path(self) -> None:
        step = self.step("Run live readiness/privacy Safari smoke")
        self.assertNotIn("always()", step)
        self.assertNotIn("continue-on-error", step)

    def test_remote_readiness_does_not_bypass_failed_local_https(self) -> None:
        self.assertLess(
            self.workflow.index("- name: Start local HTTPS harness"),
            self.workflow.index("- name: Run live readiness/privacy Safari smoke"),
        )
        self.assertNotIn("always()", self.step("Run live readiness/privacy Safari smoke"))

    def test_remote_readiness_does_not_bypass_failed_safaridriver(self) -> None:
        self.assertLess(
            self.workflow.index("- name: Enable and start SafariDriver"),
            self.workflow.index("- name: Run live readiness/privacy Safari smoke"),
        )
        self.assertNotIn("always()", self.step("Run live readiness/privacy Safari smoke"))

    def test_remote_readiness_does_not_bypass_failed_local_jpeg(self) -> None:
        self.assertLess(
            self.workflow.index("- name: Run deterministic local Safari JPEG gate"),
            self.workflow.index("- name: Run live readiness/privacy Safari smoke"),
        )
        self.assertNotIn("always()", self.step("Run live readiness/privacy Safari smoke"))

    def test_live_remote_jpeg_requires_successful_remote_readiness(self) -> None:
        step = self.step("Run live Safari JPEG gate")
        self.assertNotIn("always()", step)
        self.assertIn("steps.remote_readiness.outcome == 'success'", step)
        self.assertIn(
            "steps.remote_readiness.outputs.status != 'INCONCLUSIVE_REMOTE_READINESS'",
            step,
        )

    def test_inconclusive_skips_live_remote_jpeg(self) -> None:
        self.assertIn(
            "steps.remote_readiness.outputs.status != 'INCONCLUSIVE_REMOTE_READINESS'",
            self.step("Run live Safari JPEG gate"),
        )
        self.assertIn(
            "steps.remote_readiness.outputs.status == 'INCONCLUSIVE_REMOTE_READINESS'",
            self.step("Preserve inconclusive remote JPEG artifact"),
        )

    def test_cleanup_and_artifact_uploads_remain_always(self) -> None:
        self.assertIn("if: always()", self.step("Stop local browser services"))
        self.assertIn("if: always()", self.step("Upload local Safari JPEG diagnostic"))
        self.assertIn("if: always()", self.step("Upload live readiness/privacy Safari smoke"))
        self.assertIn("if: always()", self.step("Upload live Safari JPEG diagnostic"))

    def test_mandatory_local_gate_is_not_softened(self) -> None:
        local_gate = self.step("Run deterministic local Safari JPEG gate")
        self.assertNotIn("continue-on-error", local_gate)
        self.assertNotIn("always()", local_gate)


if __name__ == "__main__":
    unittest.main()

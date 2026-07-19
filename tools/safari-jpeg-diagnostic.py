#!/usr/bin/env python3
"""Run the deterministic Safari JPEG gate without WebDriver file transport.

SafariDriver's native ``send_file`` path can expose file metadata while the
underlying bytes are already unreadable on GitHub-hosted macOS runners. This
diagnostic therefore transports only synthetic fixture bytes into the page,
constructs an in-memory ``File`` in real Safari, dispatches the application's
normal change event, and records only safe fixture and browser-stage metadata.
It never sends a scene request and never handles user media.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Any


def load_smoke_module() -> Any:
    module_path = Path(__file__).with_name("safari-smoke.py")
    spec = importlib.util.spec_from_file_location("owli_safari_smoke", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load safari-smoke.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SMOKE = load_smoke_module()
TERMINAL_TEXTS = (
    "Normalisiertes JPEG:",
    "Das Bild konnte lokal nicht verarbeitet werden.",
    "Das Bild überschreitet die lokalen Abmessungsgrenzen.",
    "Die Bilddatei ist beschädigt oder unvollständig.",
    "Der Browser konnte das Bild nicht dekodieren.",
    "Der Browser konnte kein JPEG erzeugen.",
)


def fixture_metadata(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "sips",
            "-g",
            "pixelWidth",
            "-g",
            "pixelHeight",
            "-g",
            "format",
            "-g",
            "space",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return {
        "bytes": path.stat().st_size,
        "sips": [line.strip() for line in completed.stdout.splitlines() if line.strip()],
    }


def execute_async(driver: Any, script: str, args: list[Any] | None = None) -> Any:
    driver._session_request("POST", "/timeouts", {"script": 90_000})
    response = driver._session_request(
        "POST",
        "/execute/async",
        {"script": script, "args": args or []},
    )
    return response.get("value")


def wait_for_app_outcome(driver: Any, timeout: float = 15) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_snapshot: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last_snapshot = SMOKE.page_snapshot(driver)
        body = str(last_snapshot.get("bodyText", ""))
        matched = next((text for text in TERMINAL_TEXTS if text in body), None)
        if matched:
            return {"matchedText": matched, "snapshot": last_snapshot}
        time.sleep(0.25)
    return {"matchedText": None, "snapshot": last_snapshot}


def install_file_capture(driver: Any) -> None:
    installed = driver.execute(
        """
        const input = document.querySelector('#scene-file');
        if (!input) return false;
        window.__owliDiagnosticImmediate = null;
        document.addEventListener('change', (event) => {
          if (event.target !== input) return;
          const file = input.files?.[0] ?? null;
          if (!file) {
            window.__owliDiagnosticImmediate = Promise.resolve({ filePresent: false });
            return;
          }

          const result = (promise) => promise.then(
            (value) => ({ status: 'PASS', ...value }),
            (error) => ({
              status: 'FAIL',
              name: error?.name ?? 'Error',
              message: String(error?.message ?? error)
            })
          );
          const fileReader = (source) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
            reader.onabort = () => reject(new DOMException('FileReader aborted', 'AbortError'));
            reader.onload = () => resolve({
              byteLength: reader.result instanceof ArrayBuffer ? reader.result.byteLength : 0
            });
            reader.readAsArrayBuffer(source);
          });

          const sliced = file.slice(0, file.size, file.type);
          const directArrayBuffer = result(
            file.arrayBuffer().then((buffer) => ({ byteLength: buffer.byteLength }))
          );
          const slicedArrayBuffer = result(
            sliced.arrayBuffer().then((buffer) => ({ byteLength: buffer.byteLength }))
          );
          const fileReaderDirect = result(fileReader(file));
          const fileReaderSlice = result(fileReader(sliced));

          window.__owliDiagnosticImmediate = Promise.all([
            directArrayBuffer,
            slicedArrayBuffer,
            fileReaderDirect,
            fileReaderSlice
          ]).then(([
            directArrayBufferValue,
            slicedArrayBufferValue,
            fileReaderDirectValue,
            fileReaderSliceValue
          ]) => ({
            filePresent: true,
            file: { type: file.type, size: file.size },
            stages: {
              directArrayBuffer: directArrayBufferValue,
              slicedArrayBuffer: slicedArrayBufferValue,
              fileReaderDirect: fileReaderDirectValue,
              fileReaderSlice: fileReaderSliceValue
            }
          }));
        }, { capture: true, once: true });
        return true;
        """
    )
    if installed is not True:
        raise RuntimeError("Unable to install Safari file capture listener")


def browser_pipeline(driver: Any) -> dict[str, Any]:
    value = execute_async(
        driver,
        """
        const done = arguments[arguments.length - 1];
        const result = window.__owliDiagnosticImmediate;
        if (!result) {
          done({ filePresent: false, missing: true });
          return;
        }
        Promise.resolve(result).then(done, (error) => done({
          fatal: {
            name: error?.name ?? 'Error',
            message: String(error?.message ?? error)
          }
        }));
        """,
    )
    if not isinstance(value, dict):
        raise RuntimeError(f"Unexpected browser diagnostic response: {value}")
    return value


def select_in_memory_file(driver: Any, fixture: Path) -> None:
    encoded = base64.b64encode(fixture.read_bytes()).decode("ascii")
    selected = driver.execute(
        """
        const encoded = arguments[0];
        const name = arguments[1];
        const input = document.querySelector('#scene-file');
        if (!input) return false;
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], name, { type: 'image/jpeg' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input.files?.length === 1;
        """,
        [encoded, fixture.name],
    )
    if selected is not True:
        raise RuntimeError("Unable to select in-memory Safari JPEG fixture")


def run_case(driver: Any, target_url: str, fixture: Path) -> dict[str, Any]:
    driver.navigate(target_url)
    readiness = SMOKE.wait_until(
        lambda: SMOKE.page_snapshot(driver),
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
    install_file_capture(driver)
    select_in_memory_file(driver, fixture)
    app_outcome = wait_for_app_outcome(driver)
    return {
        "fixtureTransport": "in_memory_file",
        "readiness": {
            "hasManifest": readiness.get("hasManifest"),
            "readyState": readiness.get("readyState"),
        },
        "appOutcome": app_outcome,
        "browserPipeline": browser_pipeline(driver),
    }


def is_local_target(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    try:
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and port is not None
        and parsed.path in ("", "/")
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and parsed.username is None
        and parsed.password is None
    )


def validate_target(url: str) -> tuple[str, bool]:
    if is_local_target(url):
        return url.rstrip("/"), True
    return SMOKE.validate_target(url), False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()

    target_url, local_target = validate_target(args.target_url)
    args.artifacts.mkdir(parents=True, exist_ok=True)
    driver = SMOKE.SafariDriver(accept_insecure_certs=local_target)
    report: dict[str, Any] = {
        "targetUrl": target_url,
        "targetKind": "local_harness" if local_target else "remote_staging",
        "testedRevision": os.environ.get("TESTED_REVISION", "unknown"),
        "status": "FAIL",
        "cases": {},
    }

    with tempfile.TemporaryDirectory(prefix="owli-safari-diagnostic-") as temp_dir:
        fixture_dir = Path(temp_dir)
        source_png = fixture_dir / "source.png"
        jpeg_1mp = fixture_dir / "synthetic-1mp.jpg"
        jpeg_12mp = fixture_dir / "synthetic-12mp.jpg"
        jpeg_24mp = fixture_dir / "synthetic-24mp.jpg"
        source_png.write_bytes(base64.b64decode(SMOKE.PNG_FIXTURE))
        SMOKE.create_jpeg_fixture(source_png, jpeg_1mp, width=1000, height=1000)
        SMOKE.create_jpeg_fixture(source_png, jpeg_12mp, width=4000, height=3000)
        SMOKE.create_jpeg_fixture(source_png, jpeg_24mp, width=6000, height=4000)

        for fixture in (jpeg_1mp, jpeg_12mp, jpeg_24mp):
            shutil.copy2(fixture, args.artifacts / fixture.name)

        report["fixtureMetadata"] = {
            "jpeg1mp": fixture_metadata(jpeg_1mp),
            "jpeg12mp": fixture_metadata(jpeg_12mp),
            "jpeg24mp": fixture_metadata(jpeg_24mp),
        }

        try:
            driver.start()
            report["cases"]["jpeg1mp"] = run_case(driver, target_url, jpeg_1mp)
            report["cases"]["jpeg12mp"] = run_case(driver, target_url, jpeg_12mp)
            report["cases"]["jpeg24mp"] = run_case(driver, target_url, jpeg_24mp)

            one_mp_passed = (
                report["cases"]["jpeg1mp"]["appOutcome"]["matchedText"]
                == "Normalisiertes JPEG:"
            )
            twelve_mp_passed = (
                report["cases"]["jpeg12mp"]["appOutcome"]["matchedText"]
                == "Normalisiertes JPEG:"
            )
            twenty_four_mp_passed = (
                report["cases"]["jpeg24mp"]["appOutcome"]["matchedText"]
                == "Das Bild überschreitet die lokalen Abmessungsgrenzen."
            )
            report["status"] = (
                "PASS"
                if one_mp_passed and twelve_mp_passed and twenty_four_mp_passed
                else "FAIL"
            )
        except Exception as error:  # noqa: BLE001 - safe diagnostic summary
            report["fatal"] = {"type": type(error).__name__, "message": str(error)}
            try:
                driver.screenshot(args.artifacts / "diagnostic-failure.png")
            except Exception:  # noqa: BLE001 - best effort only
                pass
        finally:
            driver.quit()

    result_path = args.artifacts / "jpeg-diagnostic.json"
    result_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report.get("status") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

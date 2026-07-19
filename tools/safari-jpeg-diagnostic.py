#!/usr/bin/env python3
"""Diagnose Safari JPEG normalization without sending scene requests or retaining user data."""

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


def browser_pipeline(driver: Any) -> dict[str, Any]:
    value = execute_async(
        driver,
        r"""
        const done = arguments[arguments.length - 1];
        (async () => {
          const result = { stages: {} };
          const input = document.querySelector('#scene-file');
          const file = input?.files?.[0];
          result.inputPresent = Boolean(input);
          result.filePresent = Boolean(file);
          if (!file) {
            done(result);
            return;
          }

          result.file = {
            type: file.type,
            size: file.size,
            nameSuffix: file.name.includes('.') ? file.name.split('.').pop() : ''
          };

          try {
            const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
            result.stages.arrayBuffer = {
              status: 'PASS',
              magic: Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('')
            };
          } catch (error) {
            result.stages.arrayBuffer = {
              status: 'FAIL',
              name: error?.name ?? 'Error',
              message: String(error?.message ?? error)
            };
          }

          if (typeof createImageBitmap === 'function') {
            try {
              const bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
              result.stages.createImageBitmap = {
                status: 'PASS',
                width: bitmap.width,
                height: bitmap.height
              };
              bitmap.close();
            } catch (error) {
              result.stages.createImageBitmap = {
                status: 'FAIL',
                name: error?.name ?? 'Error',
                message: String(error?.message ?? error)
              };
            }
          } else {
            result.stages.createImageBitmap = { status: 'UNSUPPORTED' };
          }

          let image;
          let objectUrl;
          try {
            objectUrl = URL.createObjectURL(file);
            image = new Image();
            await new Promise((resolve, reject) => {
              image.onload = resolve;
              image.onerror = () => reject(new Error('HTML image load failed'));
              image.src = objectUrl;
            });
            result.stages.htmlImageLoad = {
              status: 'PASS',
              width: image.naturalWidth,
              height: image.naturalHeight,
              complete: image.complete
            };

            if (typeof image.decode === 'function') {
              try {
                await image.decode();
                result.stages.htmlImageDecode = { status: 'PASS' };
              } catch (error) {
                result.stages.htmlImageDecode = {
                  status: 'FAIL',
                  name: error?.name ?? 'Error',
                  message: String(error?.message ?? error)
                };
              }
            } else {
              result.stages.htmlImageDecode = { status: 'UNSUPPORTED' };
            }

            const canvas = document.createElement('canvas');
            const maxSide = 1280;
            const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d', { alpha: false });
            result.stages.canvasContext = {
              status: context ? 'PASS' : 'FAIL',
              width: canvas.width,
              height: canvas.height
            };

            if (context) {
              try {
                context.setTransform(scale, 0, 0, scale, 0, 0);
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
                context.drawImage(image, 0, 0);
                result.stages.drawImage = { status: 'PASS' };
              } catch (error) {
                result.stages.drawImage = {
                  status: 'FAIL',
                  name: error?.name ?? 'Error',
                  message: String(error?.message ?? error)
                };
              }

              try {
                const blob = await new Promise((resolve) => {
                  canvas.toBlob(resolve, 'image/jpeg', 0.82);
                });
                result.stages.toBlob = blob
                  ? { status: 'PASS', type: blob.type, size: blob.size }
                  : { status: 'FAIL', reason: 'null blob' };
              } catch (error) {
                result.stages.toBlob = {
                  status: 'FAIL',
                  name: error?.name ?? 'Error',
                  message: String(error?.message ?? error)
                };
              }
            }

            canvas.width = 1;
            canvas.height = 1;
          } catch (error) {
            result.stages.htmlImageLoad = {
              status: 'FAIL',
              name: error?.name ?? 'Error',
              message: String(error?.message ?? error)
            };
          } finally {
            if (image) image.src = '';
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          }

          done(result);
        })().catch((error) => done({
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
        "local harness controls",
        timeout=30,
    )
    driver.send_file("#scene-file", fixture)
    app_outcome = wait_for_app_outcome(driver)
    return {
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

#!/usr/bin/env python3
"""Inspect Safari file reads started inside the original change-event turn."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


def load_diagnostic_module() -> Any:
    module_path = Path(__file__).with_name("safari-jpeg-diagnostic.py")
    spec = importlib.util.spec_from_file_location("owli_safari_jpeg_diagnostic", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load safari-jpeg-diagnostic.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


DIAGNOSTIC = load_diagnostic_module()
ORIGINAL_TEMPORARY_DIRECTORY = DIAGNOSTIC.tempfile.TemporaryDirectory


def safari_fixture_directory(*args: Any, **kwargs: Any) -> Any:
    downloads = Path.home() / "Downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    kwargs.setdefault("dir", downloads)
    directory = ORIGINAL_TEMPORARY_DIRECTORY(*args, **kwargs)
    Path(directory.name).chmod(0o755)
    return directory


DIAGNOSTIC.tempfile.TemporaryDirectory = safari_fixture_directory


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
    value = DIAGNOSTIC.execute_async(
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


def run_case(driver: Any, target_url: str, fixture: Path) -> dict[str, Any]:
    driver.navigate(target_url)
    readiness = DIAGNOSTIC.SMOKE.wait_until(
        lambda: DIAGNOSTIC.SMOKE.page_snapshot(driver),
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
    driver.send_file("#scene-file", fixture)
    app_outcome = DIAGNOSTIC.wait_for_app_outcome(driver)
    return {
        "readiness": {
            "hasManifest": readiness.get("hasManifest"),
            "readyState": readiness.get("readyState"),
        },
        "appOutcome": app_outcome,
        "browserPipeline": browser_pipeline(driver),
    }


DIAGNOSTIC.run_case = run_case
raise SystemExit(DIAGNOSTIC.main())

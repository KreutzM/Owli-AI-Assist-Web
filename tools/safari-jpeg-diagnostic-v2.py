#!/usr/bin/env python3
"""Preserve Safari's selected File before the application clears the file input."""

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
ORIGINAL_BROWSER_PIPELINE = DIAGNOSTIC.browser_pipeline


def install_file_capture(driver: Any) -> None:
    installed = driver.execute(
        """
        const input = document.querySelector('#scene-file');
        if (!input) return false;
        window.__owliDiagnosticFile = null;
        document.addEventListener('change', (event) => {
          if (event.target === input) {
            window.__owliDiagnosticFile = input.files?.[0] ?? null;
          }
        }, { capture: true, once: true });
        return true;
        """
    )
    if installed is not True:
        raise RuntimeError("Unable to install Safari file capture listener")


def browser_pipeline(driver: Any) -> dict[str, Any]:
    capture = driver.execute(
        """
        const input = document.querySelector('#scene-file');
        const captured = window.__owliDiagnosticFile ?? null;
        if (!input || !captured) {
          return { inputPresent: Boolean(input), capturedPresent: Boolean(captured) };
        }
        Object.defineProperty(input, 'files', {
          configurable: true,
          get: () => [captured]
        });
        return {
          inputPresent: true,
          capturedPresent: true,
          type: captured.type,
          size: captured.size
        };
        """
    )
    result = ORIGINAL_BROWSER_PIPELINE(driver)
    result["capture"] = capture
    return result


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

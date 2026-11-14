"""Quiet error output for the pipeline. The nightly job's logs are public, and an error message can
carry a row value such as the name of an owner who is published as "Individual owner". An uncaught
error prints where it happened, never the message. Set DASHBOARD_VERBOSE_ERRORS=1 locally to see it.
"""
import os, sys, traceback


def quiet_errors():
    def hook(etype, value, tb):
        where = traceback.extract_tb(tb)[-1]
        name = where.filename.replace(chr(92), "/").split("/")[-1]
        print(f"pipeline error: {etype.__name__} at {name}:{where.lineno} (message withheld)", file=sys.stderr)

    if not os.environ.get("DASHBOARD_VERBOSE_ERRORS"):
        sys.excepthook = hook

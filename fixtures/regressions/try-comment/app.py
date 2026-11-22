"""The comment explains the try body, NOT why the exception is swallowed."""

import json


def parse_payload(raw):
    try:
        # Normalise the payload shape before parsing (v2 schema).
        # See https://example.com/schema for the field list.
        data = json.loads(raw)
        return normalise(data)
    except Exception:
        pass

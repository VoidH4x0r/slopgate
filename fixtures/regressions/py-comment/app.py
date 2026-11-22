"""Swallowed exceptions with an explanatory comment in the usual place."""


def describe(obj):
    try:
        obj.__orig_class__ = obj
    # Some objects raise TypeError if you try to set attributes on them,
    # so the failure here is expected and safe to ignore.
    except Exception:
        pass
    return obj


def close_quietly(handle):
    try:
        handle.close()
    except OSError:
        # already closed by the caller
        pass

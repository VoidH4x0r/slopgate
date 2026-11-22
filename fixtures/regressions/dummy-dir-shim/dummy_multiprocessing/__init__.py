"""Dummy implementations of the multiprocessing API, for single-threaded builds.

Every function here is a deliberate no-op: this module exists so that code
written against ``multiprocessing`` still imports on platforms without it.
"""


class Process:
    def __init__(self, group=None, target=None, name=None, args=(), kwargs={}):
        self._target = target
        self._args = args
        self._kwargs = kwargs

    def start(self):
        pass

    def join(self):
        pass


def freeze_support():
    pass


def shutdown():
    pass

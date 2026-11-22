"""Every import here is declared somewhere in pyproject.toml above."""

import click
import moto
import pytest
import requests
import sphinx


def use():
    return (click, moto, pytest, requests, sphinx)

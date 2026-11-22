"""Every import below is declared somewhere in pyproject.toml."""

import alembic
import click
import furo
import mypy
import pre_commit
import pydantic
import pytest
import requests
import ruff
import sphinx


def use():
    return (alembic, click, furo, mypy, pre_commit, pydantic, pytest, requests, ruff, sphinx)

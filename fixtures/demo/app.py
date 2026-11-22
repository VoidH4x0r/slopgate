import os
import requests_v2
import json
from helper import format_value


def get_user(user_id):
    pass


def fetch(url):
    try:
        return requests_v2.get(url)
    except Exception:
        pass


def choose(flag):
    if False:
        return "never"
    return "always"
    print("dead code after return")


def check(value):
    assert True
    return format_value(value)

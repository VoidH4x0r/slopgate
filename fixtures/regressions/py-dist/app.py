"""Every import below resolves to a distribution that IS declared in pyproject.toml."""

import docx
import grpc
import git
import pptx
from dateutil import parser
from bs4 import BeautifulSoup
from sklearn.linear_model import LinearRegression


def unused():
    return (docx, grpc, git, pptx, parser, BeautifulSoup, LinearRegression)

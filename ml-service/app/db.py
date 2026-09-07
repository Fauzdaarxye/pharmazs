"""Configuration and database access for the PharmaIQ ML service.

The dataset window is fixed (2024-09-01 .. 2026-08-31) but we NEVER hardcode the
"current" month in queries — we always derive it from MAX(sale_date), per
CONTRACT.md §4.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from functools import lru_cache

import pandas as pd
import pymysql
from dotenv import load_dotenv

load_dotenv()


class Settings:
    DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
    DB_PORT = int(os.getenv("DB_PORT", "3307"))
    DB_NAME = os.getenv("DB_NAME", "pharmaiq")
    DB_USER = os.getenv("DB_USER", "pharmaiq")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "pharmaiq_dev_2026")
    ML_HOST = os.getenv("ML_HOST", "127.0.0.1")
    ML_PORT = int(os.getenv("ML_PORT", "8000"))


settings = Settings()


def _connect() -> pymysql.connections.Connection:
    return pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


@contextmanager
def get_conn():
    """Short-lived connection. The workload is read-mostly analytics; a fresh
    connection per request is simple and safe for a localhost-only service."""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


def query_df(sql: str, params: tuple | list | None = None) -> pd.DataFrame:
    """Run a parameterised query and return a DataFrame. SQL is always
    parameterised — no string interpolation of values (CONTRACT.md §8)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            rows = cur.fetchall()
    return pd.DataFrame(rows)


def query_one(sql: str, params: tuple | list | None = None) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchone()


def execute(sql: str, params: tuple | list | None = None) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.rowcount


def executemany(sql: str, seq_params: list) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, seq_params)
            return cur.rowcount


@lru_cache(maxsize=1)
def _cached_max_date() -> str:
    row = query_one("SELECT MAX(sale_date) AS d FROM sales")
    return str(row["d"])


def max_sale_date(refresh: bool = False) -> str:
    """The latest data date; 'now' for the product is the month after this."""
    if refresh:
        _cached_max_date.cache_clear()
    return _cached_max_date()

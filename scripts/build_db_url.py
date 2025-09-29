#!/usr/bin/env python3
import os, urllib.parse
user = os.environ.get('DB_USER','')
pwd  = os.environ.get('DB_PASS','')
db   = os.environ.get('DB_NAME','')
conn = os.environ.get('CONN','')
print(f"postgres://{urllib.parse.quote(user)}:{urllib.parse.quote(pwd)}@/{urllib.parse.quote(db)}?host=/cloudsql/{conn}", end="")

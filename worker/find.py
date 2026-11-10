#!/usr/bin/env python3
"""Имя оригинала по запросу владельца: stdin — строки JSON {name} из «cloud.sh list», argv[1] — запрос.
Сравнение без регистра, ё=е, Юникод NFC (iOS пишет имена в NFD); точное имя → без расширения → начало → вхождение; «*» — первый файл папки."""
import json
import sys
import unicodedata


def norm(s):
    return unicodedata.normalize("NFC", s).casefold().replace("ё", "е").strip()


q = norm(sys.argv[1])
names = [json.loads(l)["name"] for l in sys.stdin if l.strip()]
stem = lambda x: norm(x).rsplit(".", 1)[0]
m = (names[:1] if q == "*" else [x for x in names if norm(x) == q] or [x for x in names if stem(x) == q]
     or [x for x in names if norm(x).startswith(q)] or [x for x in names if q in norm(x)])
print(m[0] if m else "")

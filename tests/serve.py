#!/usr/bin/env python3
"""Локальный сервер для автопроверок: отдаёт репозиторий, поддерживает перемотку видео (Range)."""
import http.server, os, re, sys

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_GET(self):
        m = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path): return super().do_GET()
        size = os.path.getsize(path); a = int(m[1]); b = int(m[2]) if m[2] else size - 1
        self.send_response(206); self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {a}-{b}/{size}"); self.send_header("Content-Length", str(b - a + 1)); self.end_headers()
        with open(path, "rb") as f: f.seek(a); self.wfile.write(f.read(b - a + 1))

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()

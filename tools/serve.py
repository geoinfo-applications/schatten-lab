"""Static server for site/ without caching, so a reload always gets the edited files. usage: python3 tools/serve.py [port]"""
import functools
import http.server
import sys
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8871
handler = functools.partial(NoCache, directory=str(Path(__file__).resolve().parent.parent / "site"))
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()

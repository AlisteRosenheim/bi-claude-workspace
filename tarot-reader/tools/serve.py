"""Local test server: serves www/ (and tests/ under /tests/) with caching disabled."""
import functools, http.server, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, "..", "www")
TESTS = os.path.join(HERE, "..", "tests")

class NoCache(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith("/tests/"):
            return os.path.join(TESTS, path[len("/tests/"):].split("?")[0])
        if path.startswith("/project/"):   # dev only: files in the TarotReader folder (deck pack etc.)
            return os.path.join(HERE, "..", path[len("/project/"):].split("?")[0])
        if path.startswith("/deckphotos/"):   # dev only: the user's spread-page photos for template tests
            return os.path.join(os.path.expanduser("~"), "Downloads", "Deck-20261004T075750Z-1-001", "Deck", path[len("/deckphotos/"):].split("?")[0])
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=WWW)).serve_forever()

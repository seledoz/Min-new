python -c "
import http.server, socketserver

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('0.0.0.0', 8000), Handler) as httpd:
    print('Servidor rodando em http://127.0.0.1:8000/')
    httpd.serve_forever()
"

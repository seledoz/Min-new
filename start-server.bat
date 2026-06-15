@echo off
python -c "import http.server, socketserver; type('Handler', (http.server.SimpleHTTPRequestHandler,), {'end_headers': lambda s: [s.send_header(h, v) for h, v in [('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Private-Network', 'true')]] or http.server.SimpleHTTPRequestHandler.end_headers(s), 'do_OPTIONS': lambda s: s.send_response(204) or s.end_headers()}); s = socketserver.TCPServer(('0.0.0.0', 8000), Handler); print('Servidor em http://127.0.0.1:8000/'); s.serve_forever()"
pause

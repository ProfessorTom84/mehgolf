# Meh Golf — static site served by nginx
FROM nginx:1.27-alpine

# Serve the app
COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

# Light nginx tuning: cache static assets, gzip text
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  gzip on;\n\
  gzip_types text/css application/javascript image/svg+xml;\n\
  add_header X-Content-Type-Options "nosniff" always;\n\
  add_header Referrer-Policy "no-referrer" always;\n\
  add_header Content-Security-Policy "default-src '"'"'self'"'"'; script-src '"'"'self'"'"'; style-src '"'"'self'"'"' '"'"'unsafe-inline'"'"'; img-src '"'"'self'"'"' data:; connect-src '"'"'none'"'"'; object-src '"'"'none'"'"'; frame-ancestors '"'"'none'"'"'; base-uri '"'"'self'"'"'" always;\n\
  location ~* \\.(css|js)$ { expires 7d; add_header Cache-Control "public"; }\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

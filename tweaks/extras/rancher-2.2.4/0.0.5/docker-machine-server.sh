#!/usr/bin/env bash

info() {
    echo '('$(hostname)'):' $@
}

great_success() {
    info Great Success! $@
}

error() {
    info Error! $@
}

warning() {
    info Warning! $@
}

server_side() {
    [ -e /etc/docker-machine-server/version ]
}

client_side() {
    ! server_side
}

install_nginx_ssl() {
    ! server_side && return 1
    info Installing Nginx &&\
    apt update -y &&\
    apt install -y nginx software-properties-common &&\
    if [ -e /etc/ssl/certs/dhparam.pem ]; then warning Ephemeral Diffie-Hellman key already exists at /etc/ssl/certs/dhparam.pem - delete to recreate
    else info Generating Ephemeral Diffie-Hellman key && openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048; fi &&\
    info Saving /etc/nginx/snippets/ssl.conf &&\
    echo 'ssl_dhparam /etc/ssl/certs/dhparam.pem;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_session_tickets off;
ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
# recommended cipher suite for modern browsers
ssl_ciphers 'EECDH+AESGCM:EDH+AESGCM:AES256+EECDH:AES256+EDH';
# cipher suite for backwards compatibility (IE6/windows XP)
# ssl_ciphers 'ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA256:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES256-SHA384:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES256-SHA384:ECDHE-ECDSA-AES256-SHA:ECDHE-RSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA:ECDHE-ECDSA-DES-CBC3-SHA:ECDHE-RSA-DES-CBC3-SHA:EDH-RSA-DES-CBC3-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA256:AES256-SHA256:AES128-SHA:AES256-SHA:DES-CBC3-SHA:!DSS';
ssl_prefer_server_ciphers on;
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 30s;
add_header Strict-Transport-Security "max-age=15768000; includeSubdomains; preload";
add_header X-Frame-Options SAMEORIGIN;
add_header X-Content-Type-Options nosniff;' | tee /etc/nginx/snippets/ssl.conf &&\
    info Saving /etc/nginx/snippets/http2_proxy.conf &&\
    echo 'proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port $server_port;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_read_timeout 900s;' | tee /etc/nginx/snippets/http2_proxy.conf &&\
info Clearing existing Nginx sites from /etc/nginx/sites-enabled &&\
rm -f /etc/nginx/sites-enabled/* &&\
info Saving /etc/nginx/sites-enabled/default &&\
echo '
map $http_upgrade $connection_upgrade {
    default Upgrade;
    '"''"'      close;
}
server {
  listen 80;
  server_name _;
  location / {
      return 200 '"'it works!'"';
      add_header Content-Type text/plain;
  }
}' | tee /etc/nginx/sites-enabled/default &&\
    info Restarting Nginx &&\
    systemctl restart nginx
    [ "$?" != "0" ] && error Failed to install strong security Nginx && return 1
    great_success && return 0
}

setup_ssl() {
    ! server_side && return 1
    openssl req -x509 -sha256 -newkey rsa:2048 -keyout /etc/ssl/private/server.key -out /etc/ssl/certs/server.crt -days 1024 -nodes -subj '/CN=localhost'
    great_success && return 0
}

add_certbot_domain() {
    return 0
}

add_nginx_site() {
    ! server_side && return 1
    local SERVER_NAME="${1}"
    local SITE_NAME="${2}"
    local NGINX_CONFIG_SNIPPET="${3}"
    ( [ -z "${SERVER_NAME}" ] || [ -z "${SITE_NAME}" ] || [ -z "${NGINX_CONFIG_SNIPPET}" ] ) \
        && error missing required arguments && return 1
    info Adding nginx Site &&\
    info SERVER_NAME=${SERVER_NAME} SITE_NAME=${SITE_NAME} NGINX_CONFIG_SNIPPET=${NGINX_CONFIG_SNIPPET} &&\
    info Saving /etc/nginx/sites-enabled/${SITE_NAME} &&\
    echo '
map $http_upgrade $connection_upgrade {
    default Upgrade;
    '"''"'      close;
}
server {
  listen 80;
  listen    [::]:80;
  server_name '${SERVER_NAME}';
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name '${SERVER_NAME}';
  ssl_certificate      /etc/ssl/certs/server.crt;
  ssl_certificate_key  /etc/ssl/private/server.key;
  include snippets/ssl.conf;
  include snippets/'${NGINX_CONFIG_SNIPPET}'.conf;
}' | tee /etc/nginx/sites-enabled/${SITE_NAME} &&\
    info Restarting Nginx &&\
    systemctl restart nginx
    [ "$?" != "0" ] && error Failed to add Nginx site && return 1
    great_success && return 0
}

add_nginx_site_http2_proxy() {
    ! server_side && return 1
    local SERVER_NAME="${1}"
    local SITE_NAME="${2}"
    local NGINX_CONFIG_SNIPPET="${3}"
    local PROXY_PASS_PORT="${4}"
    ( [ -z "${SERVER_NAME}" ] || [ -z "${SITE_NAME}" ] || [ -z "${NGINX_CONFIG_SNIPPET}" ] || [ -z "${PROXY_PASS_PORT}" ] ) \
        && error missing required arguments && return 1
    info Saving /etc/nginx/snippets/${NGINX_CONFIG_SNIPPET}.conf &&\
    echo "location / {
  proxy_pass http://localhost:${PROXY_PASS_PORT};
  include snippets/http2_proxy.conf;
}" | sudo tee /etc/nginx/snippets/${NGINX_CONFIG_SNIPPET}.conf &&\
    add_nginx_site "${SERVER_NAME}" "${SITE_NAME}" "${NGINX_CONFIG_SNIPPET}"
}

init() {
    ! client_side && return 1
    ! local ACTIVE_DOCKER_MACHINE=`docker-machine active` && return 1
    local DOCKER_MACHINE_SERVER_VERSION="${1}"
    info Initializing Docker Machine ${ACTIVE_DOCKER_MACHINE} with docker-machine-server v${DOCKER_MACHINE_SERVER_VERSION} &&\
    docker-machine ssh ${ACTIVE_DOCKER_MACHINE} \
        'sudo bash -c "
            curl  -s -f https://raw.githubusercontent.com/cloudwm/installer/staging/tweaks/extras/rancher-2.2.4/0.0.5/docker-machine-server.sh > /usr/local/bin/docker-machine-server &&\
            chmod +x /usr/local/bin/docker-machine-server &&\
            mkdir -p /etc/docker-machine-server && echo '${DOCKER_MACHINE_SERVER_VERSION}' > /etc/docker-machine-server/version
        "'
    [ "$?" != "0" ] && error Failed to initialize docker-machine-server && return 1
    great_success && return 0
}

eval "$@"

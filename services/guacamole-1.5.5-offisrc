#!/bin/bash

if [ -f "include/startup.sh" ]; then
    . include/startup.sh
elif [ -f "../include/startup.sh" ]; then
    . ../include/startup.sh
fi

MACHINE_IP=$(hostname -I | awk '{print $1}')
DOMAIN_NAME="$(echo "$MACHINE_IP" | tr '.' '-')".cloud-xip.com

rootDir="$(rootDir)"
updateStatus="$rootDir/include/updateInstallStatus.sh"
HTML_PATH="/var/www/html/index.html"

GUAC_DIR="/opt/guacamole"
GUAC_DB="guacdb"
GUAC_USER="admin"
GUAC_PASS="${ADMINPASSWORD}"
GUAC_VERSION="1.5.5"

install_dependencies() {
    apt update
    apt install -y certbot python3-certbot-nginx jq
}

install_docker() {
    if command -v docker >/dev/null 2>&1; then
        echo "Docker is already installed. Skipping Docker installation." | log
        "$updateStatus" "$HTML_PATH" -ap "Docker is already installed. Skipping Docker installation."
        return
    fi

    echo "Adding docker GPG key..." | log
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list

    echo "Installing Docker engine & plugins..." | log
    "$updateStatus" "$HTML_PATH" -ap "Installing Docker engine & plugins..."
    apt update
    apt install -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

    echo "Enabling & Starting docker service..."
    systemctl enable --now docker

    echo "Docker installation completed successfully." | log
    "$updateStatus" "$HTML_PATH" -ap "Docker installation completed successfully."
    echo "Verify with:  sudo docker run hello-world" | log
}

open_ports() {
    echo "[INFO] Configuring firewall rules..." | log
    ufw allow 22/tcp || true
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 8080/tcp
    ufw --force enable
    echo "[INFO] UFW firewall configured for ports 22, 80, 443, and 8080." | log
}

prepare_environment() {
    echo "[INFO] Preparing Guacamole directories..." | log
    mkdir -p ${GUAC_DIR}
    cd ${GUAC_DIR}

    # Ensure a clean database volume
    rm -rf "${GUAC_DIR}/postgres-data"
    mkdir -p "${GUAC_DIR}/postgres-data"

    chown -R root:root ${GUAC_DIR}
}

create_docker_compose() {
    echo "[INFO] Creating docker-compose.yml for Guacamole..." | log
    cat > ${GUAC_DIR}/docker-compose.yml <<EOF
services:
  guacd:
    image: guacamole/guacd:${GUAC_VERSION}
    container_name: guacd
    restart: always

  postgres:
    image: postgres:15
    container_name: guac-postgres
    restart: always
    environment:
      POSTGRES_DB: ${GUAC_DB}
      POSTGRES_USER: ${GUAC_USER}
      POSTGRES_PASSWORD: ${GUAC_PASS}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${GUAC_USER} -d ${GUAC_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - ./initdb.sql:/docker-entrypoint-initdb.d/initdb.sql
      - ./postgres-data:/var/lib/postgresql/data

  guacamole:
    image: guacamole/guacamole:${GUAC_VERSION}
    container_name: guacamole
    restart: always
    ports:
      - "8080:8080"
    environment:
      GUACD_HOSTNAME: guacd
      POSTGRESQL_HOSTNAME: postgres
      POSTGRESQL_DATABASE: ${GUAC_DB}
      POSTGRESQL_USER: ${GUAC_USER}
      POSTGRESQL_PASSWORD: ${GUAC_PASS}
    depends_on:
      postgres:
        condition: service_healthy
      guacd:
        condition: service_started
EOF
}

generate_db_init() {
    echo "[INFO] Generating database init script..." | log
    docker run --rm guacamole/guacamole:${GUAC_VERSION} \
        /opt/guacamole/bin/initdb.sh --postgresql > ${GUAC_DIR}/initdb.sql

}

start_guacamole() {
    echo "[INFO] Starting Guacamole containers..." | log
    cd ${GUAC_DIR}

    # Clean up possible leftovers before starting
    docker compose down -v --remove-orphans || true
    docker compose up -d

    echo "[INFO] Waiting for PostgreSQL to initialize schema..." | log
    local retries=10
    local count=0

    while [ $count -lt $retries ]; do
        if docker exec guac-postgres psql -U "${GUAC_USER}" -d "${GUAC_DB}" -c "SELECT 1 FROM guacamole_user LIMIT 1;" >/dev/null 2>&1; then
            echo "[INFO] PostgreSQL schema is ready." | log
            break
        fi
        count=$((count+1))
        echo "[INFO] Waiting for PostgreSQL... ($count/${retries})" | log
        sleep 5
    done

    if [ $count -eq $retries ]; then
        echo "[ERROR] PostgreSQL schema not initialized after waiting period." | log
        docker compose logs postgres | tail -n 50
        exit 1
    fi

    echo "[INFO] Ensuring Guacamole webapp is healthy..." | log
    retries=10
    count=0
    while [ $count -lt $retries ]; do
        if curl -fs "http://127.0.0.1:8080/guacamole/" >/dev/null 2>&1; then
            echo "[INFO] Guacamole web interface is reachable." | log
            break
        fi
        count=$((count+1))
        echo "[INFO] Waiting for Guacamole web to respond... ($count/${retries})" | log
        sleep 5
    done

    if [ $count -eq $retries ]; then
        echo "[ERROR] Guacamole web interface did not start properly." | log
        docker compose logs guacamole | tail -n 50
        exit 1
    fi

    echo "[INFO] Guacamole containers are running and healthy." | log
}

switch_nginx_to_proxy() {
    echo "[INFO] Configuring nginx reverse proxy for Guacamole..." | log
    NGINX_CONF="/etc/nginx/sites-available/guacamole.conf"
    cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN_NAME};

    location / {
        proxy_pass         http://127.0.0.1:8080/guacamole/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/guacamole.conf
    nginx -t && systemctl reload nginx
}

obtain_ssl() {
    echo "[INFO] Reloading nginx before requesting certificate..." | log
    systemctl reload nginx

    echo "[INFO] Requesting Let's Encrypt certificate..." | log
    certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "admin@${DOMAIN_NAME}" --redirect

    echo "[INFO] SSL successfully configured for https://${DOMAIN_NAME}" | log
    "$updateStatus" "$HTML_PATH" -sr
    "$updateStatus" "$HTML_PATH" -ur "Guacamole is available on https://${DOMAIN_NAME}"
}

change_default_password() {
    echo "[INFO] Changing default Guacamole password and creating new admin user..." | log

    # Install jq if not present
    if ! command -v jq >/dev/null 2>&1; then
        echo "[INFO] Installing jq for JSON parsing..." | log
        apt-get install -y jq
    fi

    local retries=30
    local count=0

    # Wait until the API endpoint responds properly
    while [ $count -lt $retries ]; do
        local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST \
            -d "username=guacadmin&password=guacadmin" \
            http://127.0.0.1:8080/guacamole/api/tokens)
        
        if [ "$http_code" = "200" ]; then
            echo "[INFO] Guacamole API is ready (HTTP $http_code)." | log
            break
        fi
        count=$((count+1))
        echo "[INFO] Waiting for Guacamole API... HTTP $http_code ($count/${retries})" | log
        sleep 5
    done

    if [ $count -eq $retries ]; then
        echo "[ERROR] Guacamole API did not become ready after ${retries} retries." | log
        return 1
    fi

    # Get authentication token using form-encoded data
    local TOKEN
    TOKEN=$(curl -s -X POST \
      -d "username=guacadmin&password=guacadmin" \
      http://127.0.0.1:8080/guacamole/api/tokens | jq -r .authToken)

    if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
        echo "[ERROR] Failed to obtain auth token. Response was: $TOKEN" | log
        docker compose logs guacamole | tail -n 30 | log
        return 1
    fi

    echo "[INFO] Successfully obtained auth token." | log

    # Create new admin user
    echo "[INFO] Creating new admin user '${GUAC_USER}'..." | log
    local create_response
    create_response=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Guacamole-Token: $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{
        \"username\": \"${GUAC_USER}\",
        \"password\": \"${GUAC_PASS}\",
        \"attributes\": {
          \"disabled\": \"\",
          \"expired\": \"\",
          \"access-window-start\": \"\",
          \"access-window-end\": \"\",
          \"valid-from\": \"\",
          \"valid-until\": \"\",
          \"timezone\": null
        }
      }" \
      http://127.0.0.1:8080/guacamole/api/session/data/postgresql/users)
    
    local create_code=$(echo "$create_response" | tail -n1)
    
    if [ "$create_code" = "200" ]; then
        echo "[INFO] New user '${GUAC_USER}' created successfully." | log
    else
        echo "[ERROR] User creation failed with HTTP $create_code" | log
        echo "$create_response" | head -n -1 | log
        return 1
    fi

    # Grant admin permissions to new user
    echo "[INFO] Granting admin permissions to '${GUAC_USER}'..." | log
    local perms_response
    perms_response=$(curl -s -w "\n%{http_code}" -X PATCH \
      -H "Guacamole-Token: $TOKEN" \
      -H "Content-Type: application/json" \
      -d "[
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"ADMINISTER\"},
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"CREATE_USER\"},
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"CREATE_USER_GROUP\"},
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"CREATE_CONNECTION\"},
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"CREATE_CONNECTION_GROUP\"},
        {\"op\":\"add\",\"path\":\"/systemPermissions\",\"value\":\"CREATE_SHARING_PROFILE\"}
      ]" \
      http://127.0.0.1:8080/guacamole/api/session/data/postgresql/users/${GUAC_USER}/permissions)
    
    local perms_code=$(echo "$perms_response" | tail -n1)
    
    if [ "$perms_code" = "204" ] || [ "$perms_code" = "200" ]; then
        echo "[INFO] Admin permissions granted to '${GUAC_USER}'." | log
    else
        echo "[ERROR] Permission grant failed with HTTP $perms_code" | log
        echo "$perms_response" | head -n -1 | log
    fi

    # Log in as the new admin user
    echo "[INFO] Logging in as new admin user to delete guacadmin..." | log
    local NEW_TOKEN
    NEW_TOKEN=$(curl -s -X POST \
      -d "username=${GUAC_USER}&password=${GUAC_PASS}" \
      http://127.0.0.1:8080/guacamole/api/tokens | jq -r .authToken)

    if [ -z "$NEW_TOKEN" ] || [ "$NEW_TOKEN" = "null" ]; then
        echo "[ERROR] Failed to obtain token for new admin user." | log
        return 1
    fi

    # Delete old guacadmin user (now logged in as different user)
    echo "[INFO] Deleting default 'guacadmin' user..." | log
    local delete_response
    delete_response=$(curl -s -w "\n%{http_code}" -X DELETE \
      -H "Guacamole-Token: $NEW_TOKEN" \
      http://127.0.0.1:8080/guacamole/api/session/data/postgresql/users/guacadmin)
    
    local delete_code=$(echo "$delete_response" | tail -n1)
    
    if [ "$delete_code" = "204" ] || [ "$delete_code" = "200" ]; then
        echo "[INFO] Default 'guacadmin' user deleted successfully." | log
        echo "[INFO] New admin credentials: ${GUAC_USER} / ${GUAC_PASS}" | log
    else
        echo "[ERROR] User deletion failed with HTTP $delete_code" | log
        echo "$delete_response" | head -n -1 | log
    fi
}

configure_motd() {
    echo "[INFO] Configuring custom MOTD..." | log
    rm -f /etc/update-motd.d/* /etc/motd
    cat <<EOF >/etc/motd
--------------------------------------------------
       Apache Guacamole Installed Successfully
--------------------------------------------------
Web Interface: https://${DOMAIN_NAME}
Admin login: ${GUAC_USER} / ${GUAC_PASS}
Database User: ${GUAC_USER}
Database Name: ${GUAC_DB}

To manage:
  cd ${GUAC_DIR}
  docker compose ps
  docker compose logs -f
--------------------------------------------------
EOF
}

#---------------------------------------------------
# Main
#---------------------------------------------------
main() {
    "$updateStatus" "$HTML_PATH" -ap "Installing dependencies..."
    install_dependencies
	
    "$updateStatus" "$HTML_PATH" -ap "Opening ports..."
    open_ports
	
    "$updateStatus" "$HTML_PATH" -ap "Installing Docker..."
    install_docker
	
    "$updateStatus" "$HTML_PATH" -ap "Preparing Guacamole environment..."
    prepare_environment
	
    "$updateStatus" "$HTML_PATH" -ap "Creating Docker Compose stack..."
    create_docker_compose
	
    "$updateStatus" "$HTML_PATH" -ap "Generating DB initialization..."
    generate_db_init
	
    "$updateStatus" "$HTML_PATH" -ap "Starting Guacamole containers..."
    start_guacamole
	
	"$updateStatus" "$HTML_PATH" -ap "Changing default password..."
    change_default_password
	
    "$updateStatus" "$HTML_PATH" -ap "Configuring Nginx proxy..."
    switch_nginx_to_proxy
	
    "$updateStatus" "$HTML_PATH" -ap "Obtaining SSL certificate..."
    obtain_ssl
	
    "$updateStatus" "$HTML_PATH" -ap "Finalizing setup..."
    configure_motd

    echo "[INFO] Apache Guacamole installation complete." | log
    echo "[INFO] Access Guacamole UI at https://${DOMAIN_NAME}" | log
}

main "$@"

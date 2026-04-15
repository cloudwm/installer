#!/bin/bash
set -euo pipefail

FARM_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_EMULATORS="$FARM_DIR/docker-compose.emulators.yml"
EMULATOR_DATA="$FARM_DIR/emulators"
PUBLIC_IP="${PUBLIC_IP:-192.168.33.10}"

ANDROID_VERSIONS=(
    "9.0:budtmo/docker-android:emulator_9.0"
    "10.0:budtmo/docker-android:emulator_10.0"
    "11.0:budtmo/docker-android:emulator_11.0"
    "12.0:budtmo/docker-android:emulator_12.0"
    "13.0:budtmo/docker-android:emulator_13.0"
    "14.0:budtmo/docker-android:emulator_14.0"
)

RESOLUTIONS=(
    "1080x1920:480"
    "1440x2560:560"
    "720x1280:320"
    "480x800:240"
    "1080x2340:420"
    "800x1280:213"
    "1200x1920:240"
)

mkdir -p "$EMULATOR_DATA"

jq_read() {
    jq -r ".$1" "$2"
}

usage() {
    cat <<'USAGE'
Android Farm Manager
====================

Usage: android-farm.sh <command> [options]

Commands:
  create      Create a new Android emulator instance
  delete      Delete an Android emulator instance
  list        List all emulator instances
  start       Start the full farm (STF + all emulators)
  stop        Stop the full farm
  restart     Restart the full farm
  connect     Connect an emulator to STF via ADB
  connect-all Connect all emulators to STF
  versions    List available Android versions
  resolutions List available screen resolutions
  status      Show status of all containers
  logs        Show logs for a specific service

Create Options:
  --name NAME          Unique name for the emulator (required)
  --version VERSION    Android version (default: 11.0)
  --resolution WxH     Screen resolution (default: 1080x1920)
  --dpi DPI            Screen DPI (default: auto-detected from resolution)
  --novnc-port PORT    Port for noVNC web access (auto-assigned if omitted)
  --adb-port PORT      ADB port (auto-assigned if omitted)

Delete Options:
  --name NAME          Name of emulator to delete (required)

Examples:
  android-farm.sh create --name phone1 --version 11.0 --resolution 1080x1920
  android-farm.sh create --name tablet1 --version 13.0 --resolution 1200x1920
  android-farm.sh delete --name phone1
  android-farm.sh list
  android-farm.sh start
  android-farm.sh connect --name phone1
USAGE
}

get_next_port() {
    local base_port=$1
    local field=$2
    local port=$base_port
    local used_ports=""

    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] || continue
        used_ports="$used_ports $(jq -r ".$field" "$f" 2>/dev/null)"
    done

    while echo "$used_ports" | grep -qw "$port" 2>/dev/null; do
        port=$((port + 1))
    done
    echo "$port"
}

get_image_for_version() {
    local version=$1
    for entry in "${ANDROID_VERSIONS[@]}"; do
        local ver="${entry%%:*}"
        local img="${entry#*:}"
        if [ "$ver" = "$version" ]; then
            echo "$img"
            return 0
        fi
    done
    echo ""
    return 1
}

get_dpi_for_resolution() {
    local resolution=$1
    for entry in "${RESOLUTIONS[@]}"; do
        local res="${entry%%:*}"
        local dpi="${entry#*:}"
        if [ "$res" = "$resolution" ]; then
            echo "$dpi"
            return 0
        fi
    done
    echo "480"
}

cmd_versions() {
    echo "Available Android Versions:"
    echo "==========================="
    for entry in "${ANDROID_VERSIONS[@]}"; do
        local ver="${entry%%:*}"
        local img="${entry#*:}"
        echo "  Android $ver  ($img)"
    done
}

cmd_resolutions() {
    echo "Available Resolutions:"
    echo "======================"
    for entry in "${RESOLUTIONS[@]}"; do
        local res="${entry%%:*}"
        local dpi="${entry#*:}"
        echo "  $res  (DPI: $dpi)"
    done
}

cmd_create() {
    local name="" version="11.0" resolution="1080x1920" dpi="" novnc_port="" adb_port=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name)       name="$2"; shift 2;;
            --version)    version="$2"; shift 2;;
            --resolution) resolution="$2"; shift 2;;
            --dpi)        dpi="$2"; shift 2;;
            --novnc-port) novnc_port="$2"; shift 2;;
            --adb-port)   adb_port="$2"; shift 2;;
            *) echo "Unknown option: $1"; exit 1;;
        esac
    done

    if [ -z "$name" ]; then
        echo "Error: --name is required"
        exit 1
    fi

    if [ -f "$EMULATOR_DATA/${name}.json" ]; then
        echo "Error: Emulator '$name' already exists"
        exit 1
    fi

    local image
    image=$(get_image_for_version "$version")
    if [ -z "$image" ]; then
        echo "Error: Unsupported Android version '$version'"
        echo "Run 'android-farm.sh versions' to see available versions"
        exit 1
    fi

    [ -z "$dpi" ] && dpi=$(get_dpi_for_resolution "$resolution")
    [ -z "$novnc_port" ] && novnc_port=$(get_next_port 6080 "novnc_port")
    [ -z "$adb_port" ] && adb_port=$(get_next_port 5555 "adb_port")

    jq -n \
        --arg name "$name" \
        --arg version "$version" \
        --arg resolution "$resolution" \
        --arg dpi "$dpi" \
        --arg image "$image" \
        --argjson novnc_port "$novnc_port" \
        --argjson adb_port "$adb_port" \
        --arg created "$(date -Iseconds)" \
        '{name:$name, version:$version, resolution:$resolution, dpi:$dpi, image:$image, novnc_port:$novnc_port, adb_port:$adb_port, created:$created}' \
        > "$EMULATOR_DATA/${name}.json"

    regenerate_compose

    echo "Emulator '$name' created:"
    echo "  Android Version: $version"
    echo "  Resolution:      $resolution"
    echo "  DPI:             $dpi"
    echo "  noVNC Port:      $novnc_port (http://${PUBLIC_IP}:${novnc_port})"
    echo "  ADB Port:        $adb_port"
    echo ""
    echo "Start it with: android-farm.sh start"
    echo "Then connect to STF: android-farm.sh connect --name $name"
}

cmd_delete() {
    local name=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name) name="$2"; shift 2;;
            *) echo "Unknown option: $1"; exit 1;;
        esac
    done

    if [ -z "$name" ]; then
        echo "Error: --name is required"
        exit 1
    fi

    if [ ! -f "$EMULATOR_DATA/${name}.json" ]; then
        echo "Error: Emulator '$name' does not exist"
        exit 1
    fi

    docker stop "android-${name}" 2>/dev/null || true
    docker rm "android-${name}" 2>/dev/null || true

    rm -f "$EMULATOR_DATA/${name}.json"
    regenerate_compose

    echo "Emulator '$name' deleted"
}

cmd_list() {
    local has_files=false
    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] && has_files=true && break
    done

    if [ "$has_files" = false ]; then
        echo "No emulators configured. Create one with:"
        echo "  android-farm.sh create --name myphone --version 11.0"
        return
    fi

    printf "%-15s %-10s %-15s %-6s %-10s %-10s %-12s\n" \
        "NAME" "ANDROID" "RESOLUTION" "DPI" "NOVNC" "ADB" "STATUS"
    printf "%-15s %-10s %-15s %-6s %-10s %-10s %-12s\n" \
        "----" "-------" "----------" "---" "-----" "---" "------"

    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] || continue
        local name version resolution dpi novnc_port adb_port status
        name=$(jq -r '.name' "$f")
        version=$(jq -r '.version' "$f")
        resolution=$(jq -r '.resolution' "$f")
        dpi=$(jq -r '.dpi' "$f")
        novnc_port=$(jq -r '.novnc_port' "$f")
        adb_port=$(jq -r '.adb_port' "$f")

        if docker inspect "android-${name}" &>/dev/null; then
            status=$(docker inspect -f '{{.State.Status}}' "android-${name}" 2>/dev/null || echo "unknown")
        else
            status="not started"
        fi

        printf "%-15s %-10s %-15s %-6s %-10s %-10s %-12s\n" \
            "$name" "$version" "$resolution" "$dpi" "$novnc_port" "$adb_port" "$status"
    done
}

regenerate_compose() {
    cat > "$COMPOSE_EMULATORS" <<'HEADER'
version: '3.8'

services:
HEADER

    local has_files=false
    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] && has_files=true && break
    done

    if [ "$has_files" = false ]; then
        cat >> "$COMPOSE_EMULATORS" <<'PLACEHOLDER'
  placeholder:
    image: alpine:latest
    command: 'true'
PLACEHOLDER
        return
    fi

    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] || continue
        local name version resolution dpi image novnc_port adb_port
        name=$(jq -r '.name' "$f")
        version=$(jq -r '.version' "$f")
        resolution=$(jq -r '.resolution' "$f")
        dpi=$(jq -r '.dpi' "$f")
        image=$(jq -r '.image' "$f")
        novnc_port=$(jq -r '.novnc_port' "$f")
        adb_port=$(jq -r '.adb_port' "$f")

        cat >> "$COMPOSE_EMULATORS" <<EOF
  android-${name}:
    image: ${image}
    container_name: android-${name}
    restart: unless-stopped
    privileged: true
    devices:
      - /dev/kvm
    environment:
      - EMULATOR_DEVICE=Samsung Galaxy S10
      - WEB_VNC=true
      - WEB_LOG=true
      - EMULATOR_SCREEN_RESOLUTION=${resolution}
      - EMULATOR_DPI=${dpi}
      - DATAPARTITION=2g
      - ADB_INSECURE=1
      - EMULATOR_ADDITIONAL_ARGS=-memory 1536 -no-snapshot -no-boot-anim -no-audio
    deploy:
      resources:
        limits:
          memory: 3g
    ports:
      - "${novnc_port}:6080"
      - "${adb_port}:5555"
    volumes:
      - android-data-${name}:/root/.android
    networks:
      - stf-network

EOF
    done

    echo "volumes:" >> "$COMPOSE_EMULATORS"
    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] || continue
        local name
        name=$(jq -r '.name' "$f")
        echo "  android-data-${name}:" >> "$COMPOSE_EMULATORS"
    done

    cat >> "$COMPOSE_EMULATORS" <<'FOOTER'

networks:
  stf-network:
    external: true
    name: android-farm_stf-network
FOOTER
}

cmd_start() {
    echo "Starting Android Farm..."
    echo ""

    echo "[1/3] Starting core services (RethinkDB, ADB, STF)..."
    cd "$FARM_DIR"
    docker compose -f docker-compose.yml up -d
    echo "  Waiting for services to initialize..."
    sleep 10

    echo "[2/3] Starting Android emulators..."
    local has_emulators=false
    if [ -f "$COMPOSE_EMULATORS" ]; then
        for f in "$EMULATOR_DATA"/*.json; do
            [ -f "$f" ] && has_emulators=true && break
        done
    fi

    if [ "$has_emulators" = true ]; then
        docker compose -f docker-compose.emulators.yml up -d
        echo "  Emulators starting (boot takes 1-3 minutes)..."
    else
        echo "  No emulators configured. Create one with:"
        echo "    android-farm.sh create --name myphone --version 11.0"
    fi

    echo "[3/3] Done!"
    echo ""
    echo "Access points:"
    echo "  STF Web UI:       http://${PUBLIC_IP}:7100"
    echo "  RethinkDB Admin:  http://${PUBLIC_IP}:8080"

    if [ "$has_emulators" = true ]; then
        echo ""
        echo "Emulator noVNC screens:"
        for f in "$EMULATOR_DATA"/*.json; do
            [ -f "$f" ] || continue
            local name novnc_port
            name=$(jq -r '.name' "$f")
            novnc_port=$(jq -r '.novnc_port' "$f")
            echo "  $name: http://${PUBLIC_IP}:${novnc_port}"
        done
    fi

    echo ""
    echo "After emulators boot (~2 min), connect them to STF:"
    echo "  android-farm.sh connect-all"
}

cmd_stop() {
    echo "Stopping Android Farm..."
    cd "$FARM_DIR"

    local has_emulators=false
    if [ -f "$COMPOSE_EMULATORS" ]; then
        for f in "$EMULATOR_DATA"/*.json; do
            [ -f "$f" ] && has_emulators=true && break
        done
    fi

    if [ "$has_emulators" = true ]; then
        docker compose -f docker-compose.emulators.yml down 2>/dev/null || true
    fi
    docker compose -f docker-compose.yml down
    echo "Farm stopped."
}

cmd_restart() {
    cmd_stop
    sleep 2
    cmd_start
}

cmd_connect() {
    local name=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name) name="$2"; shift 2;;
            *) echo "Unknown option: $1"; exit 1;;
        esac
    done

    if [ -z "$name" ]; then
        echo "Error: --name is required"
        exit 1
    fi

    if [ ! -f "$EMULATOR_DATA/${name}.json" ]; then
        echo "Error: Emulator '$name' does not exist"
        exit 1
    fi

    local adb_port
    adb_port=$(jq -r '.adb_port' "$EMULATOR_DATA/${name}.json")

    local container_ip
    container_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "android-${name}" 2>/dev/null || true)

    if [ -z "$container_ip" ]; then
        echo "Error: Emulator container 'android-${name}' is not running"
        echo "Start it with: android-farm.sh start"
        exit 1
    fi

    echo "Connecting emulator '$name' (android-${name}:5555) to STF..."
    docker exec stf adb connect "android-${name}:5555" 2>/dev/null || \
        docker exec stf adb connect "${container_ip}:5555" 2>/dev/null || \
        echo "Warning: Could not auto-connect. Try manually: docker exec stf adb connect android-${name}:5555"

    echo "Emulator '$name' should appear in STF shortly."
    echo "STF UI: http://${PUBLIC_IP}:7100"
}

cmd_connect_all() {
    local has_files=false
    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] && has_files=true && break
    done

    if [ "$has_files" = false ]; then
        echo "No emulators to connect."
        return
    fi

    for f in "$EMULATOR_DATA"/*.json; do
        [ -f "$f" ] || continue
        local name
        name=$(jq -r '.name' "$f")
        echo "--- Connecting $name ---"
        cmd_connect --name "$name"
        echo ""
    done
}

cmd_status() {
    echo "=== Docker Containers ==="
    docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | head -30
    echo ""
    echo "=== Emulator List ==="
    cmd_list
}

cmd_logs() {
    local service="${1:-stf}"
    docker logs -f --tail 100 "$service"
}

case "${1:-help}" in
    create)      shift; cmd_create "$@";;
    delete)      shift; cmd_delete "$@";;
    list)        cmd_list;;
    start)       cmd_start;;
    stop)        cmd_stop;;
    restart)     cmd_restart;;
    connect)     shift; cmd_connect "$@";;
    connect-all) cmd_connect_all;;
    versions)    cmd_versions;;
    resolutions) cmd_resolutions;;
    status)      cmd_status;;
    logs)        shift; cmd_logs "$@";;
    help|--help|-h) usage;;
    *)           echo "Unknown command: $1"; usage; exit 1;;
esac

#!/bin/bash
#
# CWM first-boot installer. Baked into the AlmaLinux template and launched once
# by cwm-firstboot.service on the first boot, independently of cloud-init (these
# AlmaLinux images boot with DataSourceNone, so no startup script is delivered).
#
# It installs git, clones the installer repo and runs the chosen contrib.

INSTALLER_NAME="installer-contrib-cpanelwhm-liveinstall-almalinux-10-64-bit.conf"
BRANCH="Hay-service-fix"
REPO="https://github.com/cloudwm/installer"
LOGFILE="/var/log/ci-startupscript.log"
SERIAL="/dev/ttyS0"

log() {
    local msg="$1"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local line="${timestamp} - ${msg}"
    echo "${line}" | tee -a "${LOGFILE}"
    if [ -w "${SERIAL}" ]; then
        echo "${line}" >> "${SERIAL}" 2>/dev/null || true
    fi
}

# --- wait for network ---
log "Checking internet connectivity"
connected=0
for i in $(seq 1 10); do
    if curl -fsS --connect-timeout 20 -o /dev/null https://github.com; then
        log "Connectivity OK on attempt ${i}"
        connected=1
        break
    fi
    log "Connectivity attempt ${i}/10 failed. Retrying in 10s..."
    sleep 10
done
if [ "${connected}" -ne 1 ]; then
    log "ERROR: no internet after 10 attempts. Aborting (will retry next boot)."
    exit 1
fi

# --- AlmaLinux minimal ships without git ---
log "Installing git"
if command -v dnf >/dev/null 2>&1; then
    dnf install -y git >> "${LOGFILE}" 2>&1
elif command -v yum >/dev/null 2>&1; then
    yum install -y git >> "${LOGFILE}" 2>&1
fi
if ! command -v git >/dev/null 2>&1; then
    log "FAIL: git unavailable after install. Aborting (will retry next boot)."
    exit 1
fi

# --- clone the installer repo ---
log "Cloning installer repository (${BRANCH})"
rm -rf /opt/installer
cloned=0
for i in $(seq 1 3); do
    if git clone "${REPO}" -b "${BRANCH}" /opt/installer >> "${LOGFILE}" 2>&1; then
        log "Repository cloned successfully"
        cloned=1
        break
    fi
    log "git clone attempt ${i}/3 failed. Retrying in 10s..."
    sleep 10
done
if [ "${cloned}" -ne 1 ]; then
    log "FAIL: could not clone installer repo. Aborting (will retry next boot)."
    exit 1
fi

chmod -R +x /opt/installer
cd /opt/installer || { log "FAIL: /opt/installer missing"; exit 1; }

log "Running installer ${INSTALLER_NAME}"
./installer "${INSTALLER_NAME}"
log "Installer finished."

#!/bin/bash

######### Only for DEV ########
cp /mnt/certs/acme-dev-ca.crt /usr/local/share/ca-certificates
exitCode=$?

if [ $exitCode -eq 0 ]; then
    update-ca-certificates
fi
###############################

INSTALLER_NAME="installer-contrib-microk8s-1.33-ubuntu24.conf"
BRANCH="staging"
LOGFILE="/var/log/ci-startupscript.log"
SERIAL="/dev/ttyS0"

log() {
    local msg="$1"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local line="${timestamp} - ${msg}"
    echo "${line}" | tee -a "${LOGFILE}"
    # Mirror to serial console if present; never let a missing port kill the script.
    if [ -w "${SERIAL}" ]; then
        echo "${line}" >> "${SERIAL}" 2>/dev/null || true
    fi
}

# Sets +x on every script referenced by execute+=(...) in the given config file.
# Sources the conf the same way ./installer does, so chained '. other.conf'
# includes are resolved too. Must be run from the installer dir (paths are relative).
chmodExecuteFiles() {
    local conf="$1"
    if [ -z "${conf}" ]; then
        conf="installer.conf"
    fi
    if [ ! -f "${conf}" ]; then
        log "WARN: config ${conf} not found, skipping chmod step"
        return 0
    fi
    log "Setting +x on execute scripts from ${conf}"

    # Make the config file itself executable too.
    if chmod +x "${conf}"; then
        log "chmod +x ${conf}"
    else
        log "WARN: chmod failed for ${conf}"
    fi

    local entries
    # Source in a subshell so the conf's side effects don't leak into this script.
    mapfile -t entries < <(
        execute=()
        . "${conf}" >/dev/null 2>&1
        printf '%s\n' "${execute[@]}"
    )

    local entry script
    for entry in "${entries[@]}"; do
        # An entry may be "path arg1 arg2"; the script is the first token.
        script="${entry%% *}"
        [ -z "${script}" ] && continue
        if [ -f "${script}" ]; then
            if chmod +x "${script}"; then
                log "chmod +x ${script}"
            else
                log "WARN: chmod failed for ${script}"
            fi
        else
            log "WARN: execute target not found: ${script}"
        fi
    done
}

curlBaseParams=(-v --connect-timeout 20)
log "Checking internet connectivity"
domain="https://www.github.com"
count=0
maxRetries=10
connected=0

while [ $count -lt $maxRetries ]; do
    log "Connectivity attempt $((count+1))/${maxRetries} -> ${domain}"
    curl "${curlBaseParams[@]}" --url "${domain}" >>"${LOGFILE}" 2>&1
    status=$?
    if [ $status -eq 0 ]; then
        log "Connectivity OK on attempt $((count+1))"
        connected=1
        break
    fi
    log "Connectivity attempt $((count+1)) failed (curl exit ${status}). Retrying in 10s..."
    ((count++))
    sleep 10
done

if [ $connected -ne 1 ]; then
    log "ERROR: Internet connectivity check failed after ${maxRetries} attempts, exiting..."
    exit 1
fi

log "Cloning installer repository"
count=0

while [ $count -lt 3 ]; do
    log "git clone attempt $((count+1))/3"
    cd /opt
    if [ -n "${BRANCH}" ]; then
        log "Cloning branch ${BRANCH}"
        git clone https://github.com/cloudwm/installer -b "${BRANCH}" >> "${LOGFILE}" 2>&1
    else
        log "Cloning default branch"
        git clone https://github.com/cloudwm/installer >> "${LOGFILE}" 2>&1
    fi
    exitCode=$?
    if [ $exitCode -eq 0 ]; then
        log "Repository cloned successfully"
        break
    fi
    log "git clone attempt $((count+1)) failed (exit ${exitCode}). Retrying in 10s..."
    count=$((count+1))
    sleep 10
done

if [ $exitCode -ne 0 ]; then
    log "FAIL: Could not clone installer repository after 3 attempts. Aborting."
    exit 1
fi

cd /opt/installer
chmodExecuteFiles "${INSTALLER_NAME}"
log "Running installer ${INSTALLER_NAME}"
./installer ${INSTALLER_NAME}


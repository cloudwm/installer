#!/bin/bash
if [ -f "include/startup.sh" ]; then
    . include/startup.sh
elif [ -f "../include/startup.sh" ]; then
    . ../include/startup.sh
fi

echo "Installing Android Farm - Android Emulator Management Platform" | log

appDir="/opt/android-emulator"
installerDir="/opt/installer/android_emulator"

echo "Installing installer prerequisites" | log
apk update
apk add curl openssl certbot

if ! command -v docker &> /dev/null; then
    echo "Installing Docker and Docker Compose" | log
    apk add docker docker-compose docker-cli-compose

    rc-update add cgroups boot
    rc-service cgroups start

    rc-update add docker default
    rc-service docker start

    echo "Waiting for Docker daemon to be ready..." | log
    for i in $(seq 1 30); do
        if docker info >/dev/null 2>&1; then
            echo "Docker is ready" | log
            break
        fi
        echo "  Waiting... ($i/30)" | log
        sleep 2
    done

    if ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker daemon did not start" | log
        exit 1
    fi
fi

echo "Configuring KVM for hardware-accelerated emulation" | log

apk add qemu-system-x86_64
modprobe kvm
modprobe kvm_intel 2>/dev/null || modprobe kvm_amd 2>/dev/null || true
chmod 666 /dev/kvm 2>/dev/null || true

if [ ! -e /dev/kvm ]; then
    echo "WARNING: /dev/kvm not found. Ensure virtualization is enabled in BIOS/VM settings." | log
fi


echo "Deploying Android Farm to ${appDir}" | log

cp -a ${installerDir} ${appDir}
mkdir -p ${appDir}/emulators

rm -rf ${appDir}/black-bg.png
python3 -c "
png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\x60\x60\x60\x00\x00\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB\x60\x82'
with open('${appDir}/black-bg.png', 'wb') as f:
    f.write(png)
"


echo "Configuring application settings" | log

if [ -z "${ADMINPASSWORD}" ]; then
    echo "ERROR: ADMINPASSWORD is empty - the panel would reject every login" | log 1
    exit 1
fi

# Panel is reached by domain; emulator noVNC ports are hit directly by IP, so
# those must not depend on DNS. This stack terminates no TLS (nginx listens on
# 80 only), so the panel URL is http, not the https other apps advertise.
panelHost="${CWM_DOMAIN:-${CWM_SERVERIP}}"
panelUrl="https://${panelHost}"

FARM_SECRET_KEY=$(openssl rand -base64 32 | tr -d /=+ | cut -c1-32)

if [ -z "${FARM_SECRET_KEY}" ]; then
    FARM_SECRET_KEY=$(head -c 512 /dev/urandom | tr -dc A-Za-z0-9 | cut -c1-32)
fi

if [ -z "${FARM_SECRET_KEY}" ]; then
    echo "ERROR: could not generate SECRET_KEY - the manager cannot create login sessions" | log 1
    exit 1
fi

cat > ${appDir}/.env << EOF
PUBLIC_IP=${CWM_SERVERIP:-${panelHost}}
SECRET_KEY=${FARM_SECRET_KEY}
EOF

# The admin password is passed by file, not through .env: docker compose
# interpolates .env values, which mangles passwords containing $ or #.
printf '%s' "${ADMINPASSWORD}" > ${appDir}/auth_pass
chmod 600 ${appDir}/auth_pass

if [ ! -s ${appDir}/auth_pass ]; then
    echo "ERROR: ${appDir}/auth_pass is empty - the panel would reject every login" | log 1
    exit 1
fi

echo "Obtaining TLS certificate for ${panelHost}" | log

LE_DIR="/etc/letsencrypt/live/${panelHost}"
FC_FILE="${LE_DIR}/fullchain.pem"
PK_FILE="${LE_DIR}/privkey.pem"

mkdir -p ${appDir}/certbot-webroot

# Must run before the stack starts: --standalone binds port 80, which nginx
# takes once it is up. Retry shape matches tweaks/nginx-letsencrypt-cert - ACME
# DNS/CAA lookups time out occasionally and one failure should not drop us
# straight to a self-signed cert.
LE_ATTEMPTS=3
LE_SLEEP=30
le_ok=0

for attempt in $(seq 1 ${LE_ATTEMPTS}); do
    echo "Let's Encrypt attempt ${attempt}/${LE_ATTEMPTS}" | log
    if certbot certonly --standalone -d "${panelHost}" \
        --non-interactive --agree-tos \
        -m "admin@${panelHost}" -v; then
        le_ok=1
        break
    fi
    if [ "${attempt}" -lt "${LE_ATTEMPTS}" ]; then
        echo "Let's Encrypt attempt ${attempt} failed; retrying in ${LE_SLEEP}s" | log
        sleep "${LE_SLEEP}"
    fi
done

if [ "${le_ok}" = "1" ]; then
    echo "LetsEncrypt Certificate Issued for server ${panelHost}" | log
else
    mkdir -p "${LE_DIR}"
    chmod 755 /etc/letsencrypt/live
    chmod 755 "${LE_DIR}"
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "${PK_FILE}" \
        -out    "${FC_FILE}" \
        -subj   "/C=IL/ST=Self-Signed/L=Self-Signed/O=Self-Signed/CN=${panelHost}" \
        2>/dev/null
    echo "Self signed certificate has been issued for server ${panelHost}" | log
fi

if [ ! -s "${FC_FILE}" ] || [ ! -s "${PK_FILE}" ]; then
    echo "ERROR: no certificate at ${LE_DIR} - nginx would fail to start" | log 1
    exit 1
fi

sed -i "s|__CWM_DOMAIN__|${panelHost}|g" ${appDir}/nginx.conf

echo "Building and starting Android Farm services" | log

cd ${appDir}
docker compose build --no-cache
waitOrStop 0 "Failed to build Android Farm"

docker compose up -d
waitOrStop 0 "Failed to start Android Farm"

echo "Waiting for services to initialize..." | log
sleep 15

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/login | grep -q "200"; then
    echo "Manager is running" | log
else
    echo "Warning: Manager may still be starting up" | log
fi

echo "Configuring auto-start on boot" | log

cat << 'EOF' > /etc/init.d/android-farm
#!/sbin/openrc-run

name="android-farm"
description="Android Farm Docker Compose stack"

depend() {
    need docker
    after docker
}

start() {
    ebegin "Starting Android Farm"
    cd /opt/android-emulator
    docker compose -f docker-compose.yml up -d --remove-orphans
    sleep 5
    if [ -f docker-compose.emulators.yml ]; then
        docker compose -f docker-compose.emulators.yml up -d
    fi
    eend $?
}

stop() {
    ebegin "Stopping Android Farm"
    cd /opt/android-emulator
    docker compose -f docker-compose.emulators.yml down 2>/dev/null
    docker compose -f docker-compose.yml down
    eend $?
}
EOF

chmod +x /etc/init.d/android-farm
rc-update add android-farm default

echo "Writing login banner" | log

rm -f /etc/motd 2>/dev/null

dockerStatus="$(rc-service docker status 2>/dev/null | sed -n 's/.*status: *//p' | head -1)"
[ -z "${dockerStatus}" ] && dockerStatus="unknown"

cat > /etc/motd << MOTD
──────────────────────────────────────────────
Android Farm - Installation Complete
──────────────────────────────────────────────

         Web Panel: ${panelUrl}
            Domain: ${panelHost}
        Machine IP: ${CWM_SERVERIP}

          Username: admin
          Password: ${ADMINPASSWORD}

     Docker Status: ${dockerStatus}

      Install Path: ${appDir}
      Compose File: ${appDir}/docker-compose.yml
          Env File: ${appDir}/.env
     Emulator Data: ${appDir}/emulators

──────────────────────────────────────────────
Android Farm management:
   rc-service android-farm restart
   cd ${appDir} && docker compose ps

Remove this message:
   rm -f /etc/motd
──────────────────────────────────────────────
MOTD

chmod 644 /etc/motd

# Alpine has no /etc/update-motd.d and its OpenSSH is built without PAM, so the
# CWM banner mechanism does not apply. sshd must print /etc/motd itself.
echo "Enabling MOTD display on SSH login" | log

# A leftover .hushlogin silently suppresses the banner.
rm -f /root/.hushlogin

motdShown=0

if [ -f /etc/ssh/sshd_config ]; then
    sed -i '/^[#[:space:]]*PrintMotd/d' /etc/ssh/sshd_config
    echo "PrintMotd yes" >> /etc/ssh/sshd_config
    rc-service sshd reload 2>/dev/null || rc-service sshd restart 2>/dev/null || true

    if sshd -T 2>/dev/null | grep -qi '^printmotd yes'; then
        motdShown=1
        echo "sshd confirmed: /etc/motd will print on login" | log
    fi
fi

if [ ${motdShown} -eq 0 ]; then
    # Either no OpenSSH (dropbear has no PrintMotd) or it could not be
    # confirmed. Print from the login shell instead. Only reached when sshd is
    # not printing, so the banner never shows twice.
    echo "sshd not confirmed - printing MOTD from /etc/profile.d instead" | log
    mkdir -p /etc/profile.d
    cat > /etc/profile.d/motd.sh << 'PROFILE'
#!/bin/sh
[ -f /etc/motd ] && cat /etc/motd
PROFILE
    chmod 644 /etc/profile.d/motd.sh
fi

echo "Scheduling certificate renewal" | log

# Renewal goes through webroot rather than --standalone so nginx keeps serving;
# the deploy hook only fires when a cert actually changed. Harmless no-op when
# the cert is self-signed (certbot has no renewal config for it).
cat > /etc/periodic/daily/android-farm-cert << RENEW
#!/bin/sh
certbot renew --quiet --webroot -w ${appDir}/certbot-webroot \
    --deploy-hook "docker exec nginx-proxy nginx -s reload"
RENEW

chmod +x /etc/periodic/daily/android-farm-cert
rc-update add crond default
rc-service crond start 2>/dev/null || true

# The MOTD carries the credentials; the CWM description file is not used here.
rm -f "${CWM_DESCFILE:-/root/description.txt}"

tagScript success

echo "Installation complete" | log
exit 0

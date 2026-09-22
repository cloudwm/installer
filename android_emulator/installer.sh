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
apk add curl openssl

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

# The CWM globals block only exports ADMINPASSWORD/CWM_SERVERIP once per
# checkout, so they can arrive empty here. An empty password would produce a
# panel that rejects every login, so fall back rather than ship one.
if [ -z "${ADMINPASSWORD}" ]; then
    echo "WARNING: ADMINPASSWORD is empty - generating a random panel password" | log
    ADMINPASSWORD=$(head -c 512 /dev/urandom | tr -dc A-Za-z0-9 | cut -c1-20)
fi

panelAddress="${CWM_SERVERIP:-${CWM_DISPLAYED_ADDRESS}}"

FARM_SECRET_KEY=$(openssl rand -base64 32 | tr -d /=+ | cut -c1-32)

if [ -z "${FARM_SECRET_KEY}" ]; then
    FARM_SECRET_KEY=$(head -c 512 /dev/urandom | tr -dc A-Za-z0-9 | cut -c1-32)
fi

if [ -z "${FARM_SECRET_KEY}" ]; then
    echo "ERROR: could not generate SECRET_KEY - the manager cannot create login sessions" | log 1
    exit 1
fi

cat > ${appDir}/.env << EOF
PUBLIC_IP=${panelAddress}
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

cat > /etc/motd << MOTD
  Android Farm - Emulator Management

  Web Panel: http://${panelAddress}
  Username:  admin
  Password:  ${ADMINPASSWORD}
MOTD

echo "Adding descriptions" | log
descriptionAppend "Android Farm Web Panel: http://${panelAddress}"
descriptionAppend " "
descriptionAppend "Android Farm Admin Username: admin"
descriptionAppend "Android Farm Admin Password: ${ADMINPASSWORD}"
descriptionAppend " "
descriptionAppend "Android Farm config location: ${appDir}/docker-compose.yml"
descriptionAppend "Android Farm emulator data: ${appDir}/emulators"

tagScript success

echo "Installation complete" | log
exit 0

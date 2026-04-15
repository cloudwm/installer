#!/bin/bash
if [ -f "include/startup.sh" ]; then
    . include/startup.sh
elif [ -f "../include/startup.sh" ]; then
    . ../include/startup.sh
fi

echo "Installing Android Farm - Android Emulator Management Platform" | log

appDir="/opt/android-emulator"
installerDir="/opt/installer/android_emulator"

if ! command -v docker &> /dev/null; then
    echo "Installing Docker and Docker Compose" | log
    apk update
    apk add docker docker-compose docker-cli-compose curl openssl jq

    rc-update add docker default
    service docker start
    sleep 5
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
chmod +x ${appDir}/android-farm.sh

echo "Configuring application settings" | log

FARM_SECRET_KEY=$(openssl rand -base64 32 | tr -d /=+ | cut -c1-32)
ADMIN_PASSWORD="${ADMINPASSWORD:-admin}"
SERVER_IP="${CWM_SERVERIP:-$(hostname -I | awk '{print $1}')}"

cat > ${appDir}/.env << EOF
PUBLIC_IP=${SERVER_IP}
AUTH_PASS=${ADMIN_PASSWORD}
SECRET_KEY=${FARM_SECRET_KEY}
EOF

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

echo "Adding descriptions" | log

descriptionAppend "Android Farm - Emulator Management Platform"
descriptionAppend " "
descriptionAppend "Web Panel: http://${SERVER_IP}"
descriptionAppend "Username: admin"
descriptionAppend "Password: ${ADMIN_PASSWORD}"
descriptionAppend " "
descriptionAppend "Features:"
descriptionAppend "  - Create/manage Android emulators (Android 9-14)"
descriptionAppend "  - noVNC remote screen access"
descriptionAppend "  - ADB shell, APK install, file push"
descriptionAppend "  - Live health monitoring and metrics"
descriptionAppend "  - Persistent across reboots"

tagScript success
exit 0

#!/usr/bin/env bash


intro() {
    echo --------------------------------
    echo Kamatera Cluster Creation Script
    echo --------------------------------
    echo
    echo This is an interactive script, do not run unattended
}


preflight() {
    echo Running preflight checks
    NEED_INSTALLS=no
    if ( ! which docker >/dev/null || ! which docker-machine >/dev/null ); then
        echo Please install Docker and Docker Machine: https://docs.docker.com/machine/install-machine/
        NEED_INSTALLS=yes
    fi
    if ! which jq >/dev/null; then
        echo Please install jq: https://stedolan.github.io/jq/
        NEED_INSTALLS=yes
    fi
    if [ "${NEED_INSTALLS}" == "yes" ]; then
        echo Dependencies are missing, please install missing dependencies as instructed above and re-run the script
        return 1
    fi
    echo Preflight successfull, all dependencies installed
    return 0
}

initialize_kamatera() {
    echo Enter your Kamatera API credentials
    ! read -e -p "KAMATERA_API_CLIENT_ID: " -i "${KAMATERA_API_CLIENT_ID}" KAMATERA_API_CLIENT_ID && return 1
    ! read -e -p "KAMATERA_API_SECRET: " -i "${KAMATERA_API_SECRET}" KAMATERA_API_SECRET && return 1
    echo Kamatera initialized successfully
    return 0
}


initialize_docker_machine_driver_kamatera() {
    echo initializing docker-machine-driver-kamatera
    local url=""
    local i=0
    for url in $(curl -s -f "https://api.github.com/repos/OriHoch/docker-machine-driver-kamatera/releases/latest" | jq -r '.assets[].browser_download_url'); do
        i=$(expr $i + 1)
        echo "${i}: ${url}"
    done
    echo "0-1: Enter a download URL manually"
    echo "0-2: Enter a path to previously downloaded driver .tar.gz"
    echo "0-3: Use existing Docker Machine driver: $(docker-machine-driver-kamatera -v 2>/dev/null)"
    echo Enter a number from the options above
    ! read -p ": " -e && return 1
    DRIVER_KAMATERA_DOWNLOAD_URL=""
    DRIVER_KAMATERA_FILE_PATH=""
    if [ "${REPLY}" == "0-1" ]; then
        echo Enter URL to a Kamatera machine driver .tar.gz
        read -p "DRIVER_KAMATERA_DOWNLOAD_URL: " -e DRIVER_KAMATERA_DOWNLOAD_URL
    elif [ "${REPLY}" == "0-2" ]; then
        echo Enter local file path to Kamatera machine driver .tar.gz
        read -p "DRIVER_KAMATERA_FILE_PATH: " -e DRIVER_KAMATERA_FILE_PATH
    elif [ "${REPLY}" == "0-3" ]; then
        echo Skipping machine driver installation
        return 0
    else
        i=0
        for url in $(curl -s -f "https://api.github.com/repos/OriHoch/docker-machine-driver-kamatera/releases/latest" | jq -r '.assets[].browser_download_url'); do
            i=$(expr $i + 1)
            [ "${i}" == "${REPLY}" ] && DRIVER_KAMATERA_DOWNLOAD_URL="${url}"
        done
        echo "DRIVER_KAMATERA_DOWNLOAD_URL: ${DRIVER_KAMATERA_DOWNLOAD_URL}"
    fi
    if [ "${DRIVER_KAMATERA_DOWNLOAD_URL}" != "" ]; then
        DRIVER_KAMATERA_FILE_PATH="$(mktemp --suffix=.tar.gz)"
        echo Downloading driver from "${DRIVER_KAMATERA_DOWNLOAD_URL}"
        ! curl -f "${DRIVER_KAMATERA_DOWNLOAD_URL}" -o "${DRIVER_KAMATERA_FILE_PATH}" -L && echo download failed && return 1
    fi
    [ "${DRIVER_KAMATERA_FILE_PATH}" == "" ] && return 1
    ! tar -xzvf "${DRIVER_KAMATERA_FILE_PATH}" && return 1
    echo Choose a path to install the driver into, sudo will be used for this installation
    read -p "INSTALL_BIN_PATH: " -e -i "${INSTALL_BIN_PATH:-/usr/local/bin}" INSTALL_BIN_PATH
    ! sudo mv -f docker-machine-driver-kamatera "${INSTALL_BIN_PATH}/" && return 1
    [ "$(which docker-machine-driver-kamatera)" != "${INSTALL_BIN_PATH}/docker-machine-driver-kamatera" ] \
        && echo downloaded docker-machine-driver-kamatera was not installed in PATH && return 1
    echo driver initialized successfully
    return 0
}

create_or_update_machine() {
    echo
    echo Servers in your Kamatera account:
    _kamatera_curl /service/servers | jq '.[]' -c
    echo
    echo Available Docker Machines:
    docker-machine ls
    echo
    echo Enter the name for an existing or new machine/server
    read -p "MACHINE_NAME: " MACHINE_NAME
    if docker-machine status $MACHINE_NAME; then
        echo Updating existing machine $MACHINE_NAME
    else
        echo Creating a new management machine
        echo Fetching available server options
        TEMPFILE=`mktemp`
        _kamatera_curl /service/server > $TEMPFILE
        echo Choose server settings from the available options
        cat $TEMPFILE | jq .ram -c
        read -p "RAM (recommended at least 4096): " KAMATERA_RAM
        cat $TEMPFILE | jq .cpu -c
        read -p "CPU (recommended at least 2B): " KAMATERA_CPU
        cat $TEMPFILE | jq .datacenters -c
        read -p "Datacenter: " KAMATERA_DATACENTER
        cat $TEMPFILE | jq .disk -c
        read -p "Disk size: " KAMATERA_DISK_SIZE
        rm $TEMPFILE
        echo Creating management server ${MACHINE_NAME}
        echo Please wait, this may take a while...
        export KAMATERA_RAM
        export KAMATERA_CPU
        export KAMATERA_DATACENTER
        export KAMATERA_DISK_SIZE
        export KAMATERA_API_SECRET
        export KAMATERA_API_CLIENT_ID
        export KAMATERA_PRIVATE_NETWORK_NAME="${1}"
        ! docker-machine create -d kamatera "${MACHINE_NAME}" && echo Failed to create the management machine && return 1
        echo cluster management machine ${MACHINE_NAME} created successfully
    fi
    eval $(docker-machine env "${MACHINE_NAME}") &&\
    [ "$(docker-machine active)" == "${MACHINE_NAME}" ]
    [ "$?" != "0" ] && echo Failed to activate machine $MACHINE_NAME && return 1
    return 0
}

install_or_update_rancher() {
    echo Set a DNA A records to "$(docker-machine ip $(docker-machine active))"
    echo The domain will be used for Rancher, e.g. rancher.my-domain.com
    read -p "Press <Enter> when the DNS A Record was set"
    echo Enter the Rancher domain name
    RANCHER_DOMAIN_NAME="_"
    echo Enter an Email for lets encrypt registration
    LETSENCRYPT_EMAIL="${email}"
    CERTBOT_DOMAINS="${RANCHER_DOMAIN_NAME}"
    LETSENCRYPT_DOMAIN="${RANCHER_DOMAIN_NAME}"
    echo
    echo Initializing Docker Machine Server
    if docker-machine ssh $(docker-machine active) ls /etc/docker-machine-server/CERTBOT_DOMAINS; then
        echo server already initialized
    else
        echo Initializing the docker machine server
        ! docker-machine-server.sh init "${1}" && echo Failed to initialize docker machine server && return 1
        ! docker-machine ssh $(docker-machine active) sudo docker-machine-server install_nginx_ssl && echo Failed to install Nginx SSL && return 1
        ! [ "$(curl -s $(docker-machine ip $(docker-machine active)))" == "it works!" ] && echo Failed to validate Nginx installation && return 1
        ! docker-machine ssh $(docker-machine active) sudo docker-machine-server setup_ssl ${LETSENCRYPT_EMAIL} ${CERTBOT_DOMAINS} ${LETSENCRYPT_DOMAIN} && echo Failed to setup Lets Encrypt && return 1
        echo server initialized successfully
    fi
    echo
    if docker ps | grep rancher; then
        echo Rancher already installed
    else
        RANCHER_IMAGE="rancher/rancher:${RANCHER_VERSION:-v2.2.2}"
        echo "Installing Rancher (${RANCHER_IMAGE})"
        docker-machine ssh $(docker-machine active) sudo mkdir -p /var/lib/rancher &&\
        docker run -d --name rancher --restart unless-stopped -p 8000:80 \
                   -v "/var/lib/rancher:/var/lib/rancher" "${RANCHER_IMAGE}" &&\
        docker-machine ssh $(docker-machine active) sudo docker-machine-server add_nginx_site_http2_proxy ${RANCHER_DOMAIN_NAME} rancher rancher 8000
        [ "$?" != "0" ] && echo Failed to install rancher && return 1
        echo Rancher installed successfully
    fi
    return 0
}


_kamatera_curl() {
    curl -s -f -H "AuthClientId: ${KAMATERA_API_CLIENT_ID}" -H "AuthSecret: ${KAMATERA_API_SECRET}" "https://console.kamatera.com"$@
}


intro &&\
preflight &&\
initialize_kamatera &&\
initialize_docker_machine_driver_kamatera &&\
create_or_update_machine "${2}" &&\
install_or_update_rancher "${1}"
[ "$?" != "0" ] && exit 1

echo Great Success!
echo
echo Please continue with the on-line guide at:
echo
echo https://github.com/OriHoch/docker-machine-server/blob/master/scripts/KAMATERA-CLUSTER.md
echo
exit 0

#!/bin/bash

function rootDir() {

    if [ -f "installer" ]; then

    	rootDir=$(pwd)

    elif [ -f "../installer" ]; then

	    rootDir=$(dirname $(pwd))

    fi

    echo $rootDir

}

# Check tempDir exists and create if not create.

function checkTempDir() {

    rootDir=$(rootDir)

    if [ ! -d "$rootDir/temp" ]; then

	    mkdir -p $rootDir/temp

    fi

}

function log() {

    logScriptName=$(basename $0)

    if [ ! -d "$CWM_LOGDIR" ]; then

	    mkdir -p $CWM_LOGDIR

    fi

    while IFS= read -r line; do

        printf '[%s] %s: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$logScriptName" "$line";

    done | tee -a $CWM_LOGDIR/$(date '+%Y-%m-%d').log ${1:+${CWM_ERRORFILE}}

}

function checkRootUser() {

    echo "Checking if user is root ... " | log

    if [ $(id -u) != '0' ]; then

        echo "Error: You must be root to run this script. exiting (1)." | log 1
        exit 1

    fi

    echo "Found user $(id -u)." | log

}

function checkOs {

    echo "Checking if OS is supported ..." | log

    if [ -n "$(grep 'Ubuntu' /etc/issue)" -o "$(lsb_release -is 2>/dev/null)" == "Ubuntu" -o -n "$(grep 'Linux Mint' /etc/issue)" ]; then

    	OS=Ubuntu
    	OSVersion=$(lsb_release -sr | awk -F. '{print $1}')

    fi

    if [[ "$OS $OSVersion" != *"Ubuntu"*"18" ]]; then

        echo "$OS $OSVersion is not supported, exiting. (1)" | log 1
        exit 1

    fi

    echo "Found supported OS: $OS $OSVersion" | log

}

function rebootSystem() {

    echo "Rebooting System" | log
    reboot | log

}

function useFiglet() {

    if [ ! -f "/usr/bin/figlet-figlet" ]; then

	    echo "Figlet not found, installing figlet." | log
        apt install figlet -y

    fi

}

function bannerFiglet() {

    if [ -f "/usr/bin/figlet" ]; then
        echo -e $1 | figlet -f big
    fi

}

function descriptionAppend() {

    echo "$1" >> $CWM_DESCFILE
    echo "Adding to system description file: $1" | log
    chmod 600 $CWM_DESCFILE

}

function tagScript() {

    rootDir=$(rootDir)
    touch $rootDir/temp/`basename $0`.$1

}

function runOnceCheck() {

    state=$1

    if [ -z "$state" ]; then

	    state="success"

    fi

    rootDir=$(rootDir)
    if [ -f "$rootDir/temp/`basename $0`.$state" ]; then

	    echo "runOnceCheck: $0 already executed, can run only once. delete $rootDir/temp/`basename $0`.$state to execute again." | log
	    echo "execution stopped, exiting (98). " | log
        exit 98;

    fi

}

function tag() {

    echo "Tagging temp/$1" | log
    rootDir=$(rootDir)
    touch $rootDir/temp/$1

}

function untag() {

    echo "Un-Tagging temp/$1" | log
    rootDir=$(rootDir)
    rm -f $rootDir/temp/$1

}

function checkTagExist() {

    rootDir=$(rootDir)
    if [ ! -f "$rootDir/temp/$1" ]; then

	    echo "checkTagExist: Tag temp/$1 doesn't exist, exiting (1)." | log 1
        exit 1;

    else

	    echo "checkTagExist: Tag temp/$1 exist. continuing." | log

    fi

}

function backupFile() {

    if [ -f "$1" ]; then

        rootDir=$(rootDir)
        echo "Backing up file $1 to $rootDir/temp/backup/"

        fileDirectory=`dirname $1`

        if [ ! -d "$rootDir/temp/backup/$fileDirectory" ]; then

	        mkdir -p $rootDir/temp/backup/$fileDirectory

        fi

	    newFilename=`basename $1`.`date +%Y%m%d%H%M%S`
        cp $1 $rootDir/temp/backup/$fileDirectory/$newFilename

    else

        echo "Backing up file $1 Failed. file doesn't exist."

    fi

}

function waitOrStop() {

    local exitCode=${PIPESTATUS[0]}
    waitExitCode=$1

    if [ $waitExitCode -ne $exitCode ]; then

	    echo "Waiting for $waitExitCode. Execution return $exitCode. exiting (1)" | log 1
        exit 1;

    fi

}

function checkPackageInstalled() {

    notInstalled=()
    for package in "$@"; do

        dpkg-query -W ${package/=*/}
        local exitCode=$?
        if [ $exitCode -ne 0 ]; then

            notInstalled+=($package)

        fi

    done

    if [ ${#notInstalled[@]} -ne 0 ]; then

        echo "Packages not installed: ${notInstalled[@]}. exiting (1)." | log 1
        exit 1;

    fi

}

function curlDownload() {

    checkPackageInstalled curl
    curlBaseParams=(--fail --location --write-out %{http_code} --max-redirs 3 --retry 3 --retry-connrefused --retry-delay 15 --speed-time 300 --speed-limit 1000)

    # check if url is given
    if [ -z "$1" ]; then

        echo "No download url is provided. Exiting (1)." | log 1
        exit 1

    fi

    # allow for nameless and nameful downloads
    if [ -z "$2" ]; then

        httpResponse=$(curl "${curlBaseParams[@]}" --url $1 --remote-name)
        local exitCode=$?

    else

        httpResponse=$(curl "${curlBaseParams[@]}" --url $1 --output $2)
        local exitCode=$?

    fi

    if [ $exitCode -ne 0 ] || [ $httpResponse -ne 200 ]; then

        echo "Download failed (exit:$exitCode,http:$httpResponse): $1" | log 1
        exit 1

    fi

}

function createSwapFile() {

    # 1:filename, 2:megabytes, 3:path

    # if path is given, know how to handle it when creating swap
    if [ ! -z $3 ]; then

        if [ -d $3 ]; then

            # path exists
            createDir=0

        else

            # new path
            createDir=1

        fi

    else

        # path not given
        createDir=2

    fi

    if [ -z $1 ]; then

        # (>&2 echo "error: no filename given to swap file")
        echo "error: no filename given to swap file" | log
        return 1

    fi

    if [[ $createDir -eq 2 && -e $1 ]] || [[ $createDir -eq 0 && -e "$3/$1" ]]; then

        echo "error: a file with this name already exists" | log
        return 1

    fi

    if [ -z $2 ]; then

        echo "error: swap size (in MB) must be provided" | log
        return 1

    fi

    if [[ $2 =~ '^[0-9]+$' ]] || [[ $2 -le 0 ]]; then

        echo "error: swap size must be a number greater than 0" | log
        return 1

    fi

    diskSizeMb=`df --output=avail -m "$PWD" | sed '1d;s/[^0-9]//g'`
    swapSizeAllowed=$((diskSizeMb/2))

    if [ $2 -gt $swapSizeAllowed ]; then

        echo "error: maximum swap size (in MB) can be $swapSizeAllowed" | log
        return 1

    fi

    # create swap in existing directory
    if [ $createDir -eq 0 ]; then

        swapFile="$3/$1"

    fi

    # create new directory for swap
    if [ $createDir -eq 1 ]; then

        mkdir -p $3
        swapFile="$3/$1"

    fi

    # create swap in current path
    if [ $createDir -eq 2 ]; then

        swapFile="$1"

    fi

    # generate swap file and mount it
    dd if=/dev/zero of=$swapFile bs=1M count=$2
    mkswap $swapFile >/dev/null || { echo 'mkswap failed' ; return 1; }
    swapon $swapFile >/dev/null || { echo 'swapon failed' ; return 1; }
    chmod 600 $swapFile >/dev/null || { echo 'chmod swapfile failed' ; return 1; }

    if [ ! -e $swapFile ]; then

        echo "error: did not complete swap creation properly"
        return 1

    fi

    echo "$swapFile"
    return 0

}

function removeSwapFile() {

    # 1: filename given when created swap with createSwapFile()
    if [ ! -e $1 ]; then

        echo "error: a swapfile with this name was not found. did nothing" | log
        return 1

    fi

    swapoff $1
    rm -f $1

    return 0

}

function noWhitespace() {
    echo "$1" | tr -d '[[:space:]]'
}

# Run Startup Functions

if [ -f "./installer-startup.conf" ]; then
    . installer-startup.conf
elif [ -f "../installer-startup.conf" ]; then
    . ../installer-startup.conf
fi

if [ -f "./include/startup-cwm.sh" ]; then
    . ./include/startup-cwm.sh
elif [ -f "../include/startup-cwm.sh" ]; then
    . ../include/startup-cwm.sh
fi

checkTempDir

#!/bin/bash

if [ -f "./installer-startup.conf" ]; then
    . installer-startup.conf
elif [ -f "../installer-startup.conf" ]; then
    . ../installer-startup.conf
fi

if [ -f "./include/startup-cwm-import-config-file" ]; then
    . ./include/startup-cwm-import-config-file
elif [ -f "../include/startup-cwm-import-config-file" ]; then
    . ../include/startup-cwm-import-config-file
fi

function rootDir() {

    if [ -f "installer" ]; then

	rootDir=$(pwd)

    elif [ -f "../installer" ]; then

	rootDir=$(dirname $(pwd))

    fi

echo $rootDir

}

function log() {

    rootDir=$(rootDir)

    if [ -z "$logDir" ]; then

	logDir="$rootDir/temp"

    fi
    
    if [ ! -d "$logDir" ]; then 

	mkdir $logDir

    fi

    while IFS= read -r line; do printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"; done | tee -a $logDir/$(date '+%Y-%m-%d').log

}

function checkRootUser() {

    echo "Checking if user is root ... " | log

    [ $(id -u) != '0' ] && { echo "Error: You must be root to run this script. exiting (1)."; exit 1; }

    echo "Found user $(id -u)." | log


}

function checkOs {

    echo "Checking if OS is supported ..." | log

    if [ -n "$(grep 'Ubuntu' /etc/issue)" -o "$(lsb_release -is 2>/dev/null)" == "Ubuntu" -o -n "$(grep 'Linux Mint' /etc/issue)" ]; 
    then

	OS=Ubuntu
	OSVersion=$(lsb_release -sr | awk -F. '{print $1}')

    fi

    if [[ "$OS $OSVersion" != *"Ubuntu"*"18" ]];
    then

        echo "$OS $OSVersion is not support, exiting. (1)" | log
        exit 1
    fi

    echo "Found Supported OS: $OS $OSVersion" | log

}


function rebootSystem() {

    echo "Rebooting System" | log
    reboot | log

}

function useFiglet() {

    if [ ! -f "/usr/bin/figlet-figlet" ]; 
    then

	echo "Figlet not found, installing figlet." | log
        apt install figlet -y

    fi

}

function bannerFiglet() {

    if [ -f "/usr/bin/figlet" ];
    then
        echo -e $1 | figlet -f big
    fi

}


function tagScript() {

    rootDir=$(rootDir)
    touch $rootDir/temp/`basename $0`.$1
}


function runOnceCheck() {

    state=$1

    if [ -z "$state" ]; 
    then

	state="success"

    fi

    rootDir=$(rootDir)
    if [ -f "$rootDir/temp/`basename $0`.$state" ]; 
    then

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

function checkTagExist() {

    rootDir=$(rootDir)
    if [ ! -f "$rootDir/temp/$1" ];
    then

	echo "checkTagExist: Tag temp/$1 doesn't exist." | log
	echo "execution stopped, exiting (1). " | log
        exit 1;

    else

	echo "checkTagExist: Tag temp/$1 exist. continuing." | log

    fi

}

function backupFile() {

    if [ -f "$1" ]; then

        rootDir=$(rootDir)
        echo "Backuping file $1 to $rootDir/temp/backup/"

        fileDirectory=`dirname $1`

        if [ ! -d "$rootDir/temp/backup/$fileDirectory" ]; then 

	mkdir -p $rootDir/temp/backup/$fileDirectory

        fi

	newFilename=`basename $1`.`date +%Y%m%d%H%M%S`
        cp $1 $rootDir/temp/backup/$fileDirectory/$newFilename

    else

        echo "Backuping file $1 Failed. file doesn't exist."

    fi

}

function waitOrStop() {

    exitCode=$?
    waitExitCode=$1

    if [ "$waitExitCode" != "$exitCode" ];
    then

	echo "Waiting for $waitExitCode. Execution return $exitCode. exiting (1)" | log
        exit 1;

    fi

}

function checkPackageInstalled() {

    if [ ! -z "$1" ];
    then

	package=`dpkg -l $1 | grep "ii.*$1 "`

	if [ -z "$package" ];
	then
	
	    echo "Package $1 is not installed. exiting (1)." | log
	    exit 1;

	fi

    fi

    unset package

}


#!/bin/bash

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

    [ $(id -u) != '0' ] && { echo "${CFAILURE}Error: You must be root to run this script${CEND}"; exit 1; }


}

function checkOs {

    echo "Checking if OS is supported ..." | log

if [ -n "$(grep 'Ubuntu' /etc/issue)" -o "$(lsb_release -is 2>/dev/null)" == "Ubuntu" -o -n "$(grep 'Linux Mint' /etc/issue)" ]; then
  OS=Ubuntu
  Ubuntu_ver=$(lsb_release -sr | awk -F. '{print $1}')
  [ -n "$(grep 'Linux Mint 18' /etc/issue)" ] && Ubuntu_ver=16
else
  echo "${CFAILURE}Does not support this OS, dying. ${CEND}" | log
  exit 1

fi

    echo "Found $OS $Ubuntu_ver" | log

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

    useFiglet
    echo -e $1 | figlet -f big -c

}


function tagScript() {

    rootDir=$(rootDir)
    touch $rootDir/temp/`basename $0`.$1
}

function runOnceCheck() {

    rootDir=$(rootDir)
    if [ -f "$rootDir/temp/`basename $0`.success" ]; 
    then

	echo "runOnceCheck: $0 already executed, can run only once. execution stopped, exit code 98. " | log
        exit 98;

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

function waitOrStop() {

    waitExitCode=$?

    if [ "$waitExitCode" -eq "$1" ];
    then

	continue;

    else

	exit 1;

    fi

}



}
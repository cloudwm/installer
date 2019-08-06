#!/bin/bash

if [ -f "$CWMCONFIGFILE" ]; then

    CONFIG=`cat $CWMCONFIGFILE`

    IFS=$'\n'

    for d in $CONFIG; do

        export `echo $d | cut -f 1 -d"="`="`echo $d | cut -f 2 -d"="`"

    done

    CWMSITE=$url
    ADMINEMAIL=$email
    ADMINPASSWORD='$password'
    ZONE=$zone
    VMNAME=$name
    WANNICIDS=`cat $CWMCONFIGFILE | grep ^vlan.*=wan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"`
    LANNICIDS=`cat $CWMCONFIGFILE | grep ^vlan.*=lan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"`
    DISKS=`cat $CWMCONFIGFILE | grep ^disk.*size=.* | wc -l`
    UUID=$(cat /sys/class/dmi/id/product_serial | cut -d '-' -f 2,3 | tr -d ' -' | sed 's/./&-/20;s/./&-/16;s/./&-/12;s/./&-/8')

    var=0
    for nicid in $WANNICIDS; do

        var=$((var+1))
        nicvar=ip${nicid}
        export `echo WANIP$var`=`echo ${!nicvar}`
        unset nicvar

    done

    var=0
    for nicid in $LANNICIDS; do

        var=$((var+1))
        nicvar=ip${nicid}
        export `echo LANIP$var`=`echo ${!nicvar}`
        unset nicvar

    done

fi

# Function: updateServerDescription
# Purpose: Update CWM Server's Overview->Descriptoin text field.
# Usage: updateServerDescription "Some kind of description"

function updateServerDescription() {

    if [[ ! -z "$apiClientId" && ! -z "$apiSecret" ]]; then

        curl -v --location -f -X PUT -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}"  "https://$CWMSITE/svc/server/$UUID/description" -d $'description='"$1"
        errorCode=$?

        if [ $errorCode != '0' ]; then

		    echo "Error updating server description" | log

	    else 

	        echo "Updated Overview->Description data for $UUID" | log

        fi

    else

	    echo "No API Client ID or Secret is set, description not set" | log

    fi

}

function getServerDescription() {

    if [[ ! -z "$apiClientId" && ! -z "$apiSecret" ]]; then

        description=`curl -v --location -f -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}" "https://$CWMSITE/svc/server/$UUID/overview" | grep -Po '(?<="description":")(.*?)(?=",")'`
        errorCode=$?

        if [ $errorCode != '0' ]; then

            echo "Error retrieving server overview"

        else 

            echo -e $description

        fi

    else

        echo "No API Client ID or Secret is set, unable to retrieve server overview"

    fi

}

function appendServerDescription() {

    description=`getServerDescription`
    fulltext=$(echo -e "$description\\n$1")
    updateServerDescription "$fulltext"

}

function appendServerDescriptionTXT() {

    rootDir=$(rootDir)
    file=$rootDir/DESCRIPTION.TXT

    if [ -f "$file" ]; then

        fileContent=`cat $file`

    fi

    description=`getServerDescription`
    fulltext=$(echo -e "$description\\n$fileContent")
    updateServerDescription "$fulltext"

}

function setServerDescriptionTXT() {

    rootDir=$(rootDir)
    file=$rootDir/DESCRIPTION.TXT

    if [ -f "$file" ]; then

        fileContent=`cat $file`

    fi

    updateServerDescription "$fileContent"

}

function getServerIP() {

    if [ ! -f "$CWMCONFIGFILE" ]; then

        hostname -I | awk '{print $1}'
        return 0

    fi
    
    IPS=`cat $CWMCONFIGFILE | grep ^ip.*=* | cut -f 2 -d"i" | cut -f 2 -d"p"`

    if [ ! -z "$WANNICIDS" ]; then

        index=`echo $WANNICIDS | awk '{print $1;}'`
        index=$((index+1))
        echo $IPS | awk -v a="$index" '{print $a;}' | cut -f 2 -d"="
        return 0

    fi

    if [ ! -z "$LANNICIDS" ]; then

        index=`echo $LANNICIDS | awk '{print $1;}'`
        index=$((index+1))
        echo $IPS | awk -v a="$index" '{print $a;}' | cut -f 2 -d"="
        return 0

    fi

}

function getServerIPAll() {

    if [ ! -f "$CWMCONFIGFILE" ]; then

        hostname -I
        return 0
        
    fi
        
    echo `cat $CWMCONFIGFILE | grep ^ip.*=* | cut -f 2 -d"="`

}

function join_by {

    local IFS="$1"; shift; echo "$*";

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

function curlDownload() {

    checkPackageInstalled curl
    
    # check if url is given
    if [ -z "$1" ]; then

        echo "No download url is provided. Exiting (1)."
        return 1
        
    fi

    # allow for nameless and nameful downloads
    if [ -z "$2" ]; then 

        httpResponse=$(curl --fail --location --write-out %{http_code} --max-redirs 3 --retry 3 --retry-connrefused --retry-delay 2 --max-time 90 --url $1 --remote-name)
        local exitCode=$?

    else

        httpResponse=$(curl --fail --location --write-out %{http_code} --max-redirs 3 --retry 3 --retry-connrefused --retry-delay 2 --max-time 90 --url $1 --output $2)
        local exitCode=$?

    fi

    if [ "$exitCode" != "0" ] || [ "$httpResponse" != "200" ]; then

        echo "Download failed with exitCode:$exitCode and httpResponse:$httpResponse"
        return 1
        
    fi

    return 0

}

SERVERIP="$(getServerIP)"

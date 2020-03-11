#!/bin/bash

# skip cwm related steps if config file not found
if [ ! -f "$CWM_CONFIGFILE" ]; then
    #Missing CWM config file. Skipping.
    return 0
fi

# Function: updateServerDescription
# Purpose: Update CWM Server's Overview->Description text field.
# Usage: updateServerDescription "Some kind of description"

function updateServerDescription() {

    curl --location -f -X PUT --retry-connrefused --retry 3 --retry-delay 2 -H "AuthClientId: ${CWM_APICLIENTID}" -H "AuthSecret: ${CWM_APISECRET}"  "https://$CWM_URL/svc/server/$CWM_UUID/description" --data-urlencode $'description='"$1"

    local exitCode=$?
    if [ $exitCode -ne 0 ]; then

        echo "Error updating server description" | log 1
        return 1

    fi

    echo "Updated Overview->Description data for $CWM_UUID" | log

}

function getServerDescription() {

    description=$(curl --location -f --retry-connrefused --retry 3 --retry-delay 2 -H "AuthClientId: ${CWM_APICLIENTID}" -H "AuthSecret: ${CWM_APISECRET}" "https://$CWM_URL/svc/server/$CWM_UUID/overview" | grep -Po '(?<="description":")(.*?)(?=",")')
    
    local exitCode=$?
    if [ $exitCode -ne 0 ]; then

        echo "Error retrieving server overview" | log 1
        return 1

    fi

    echo -e $description

}

function appendServerDescription() {

    description=$(getServerDescription)
    fulltext=$(echo -e "$description\\n$1")
    updateServerDescription "$fulltext"

}

function appendServerDescriptionTXT() {

    if [ -f "$CWM_DESCFILE" ]; then

        fileContent=$(cat $CWM_DESCFILE)

    fi

    description=$(getServerDescription)
    fulltext=$(echo -e "$description\\n\\n$fileContent")
    updateServerDescription "$fulltext"

}

function setServerDescriptionTXT() {

    if [ -f "$CWM_DESCFILE" ]; then

        fileContent=$(cat $CWM_DESCFILE)

    fi

    updateServerDescription "$fileContent"

}

function updateServerDescriptionTXT() {
    
    description=$(getServerDescription)

    uploadText=$description
    if [[ ! -z "$CWM_GUESTDESCRIPTION" && $(noWhitespace "$CWM_GUESTDESCRIPTION") != $(noWhitespace "$description") ]]; then

        uploadText=$CWM_GUESTDESCRIPTION

    fi

    if [[ -f "$CWM_DESCFILE" ]]; then

        fileContent=$(cat $CWM_DESCFILE)
        uploadText=$(echo -e "$uploadText\\n\\n$fileContent")

    fi

    updateServerDescription "$uploadText"

}

function getServerIP() {

    if [ ! -f "$CWM_CONFIGFILE" ]; then

        hostname -I | awk '{print $1}'
        return 0

    fi
    
    if [ ! -z "$CWM_WANNICIDS" ]; then

        local mainip=$(echo "CWM_IP${CWM_WANNICIDS[0]}") 
        echo "${!mainip}"
        return 0

    fi

    if [ ! -z "$CWM_LANNICIDS" ]; then

        local mainip=$(echo "CWM_IP${CWM_LANNICIDS[0]}") 
        echo "${!mainip}"
        return 0
        
    fi

}

function getServerIPAll() {

    if [ ! -f "$CWM_CONFIGFILE" ]; then

        hostname -I
        return 0
        
    fi
        
    echo `cat $CWM_CONFIGFILE | grep ^ip.*=* | cut -f 2 -d"="`

}

# Function: format string to proper JSON, ONLY works with following scheme:
# 
# JSON_STRING='{
# "arg1":"quoted value",
# "arg2":nonQuotedValue,
# "arg3":'$NON_QUOTED_VAR',
# "arg4":"'"$QOUTED_VAR"'"
# }'
# curl -X POST -H "Content-Type: application/json" --url "$URL" -d "$(jsonize "$JSON_STRING")"
function jsonize() {

    echo $1 | sed s'/, "/,"/g' | sed s'/{ /{/g' | sed s'/ }/}/g'

}

function apt() {

    if [ -x "$(command -v apt-fast)" ]; then

        command apt-fast "$@"

    else

        command apt "$@"

    fi
    
}

# run action multiple times and analyze its output, return fail if found
# all params are required
# example: execSpecial 3 'error' [COMMAND]
function execSpecial(){

local times=$1
local filter=$2
local action="${@:3}"
local ok=1
local n=0
until [ $n -ge $times ]; do

    if eval $action | grep -q -E $filter; then

        n=$[$n+1]
        sleep 10

    else

        ok=0
        break

    fi

done

return $ok

}

rootDir=$(rootDir)

if [ ! -f "$rootDir/temp/globals-set.success" ]; then

    # parse cwm config into global params
    CONFIG=`cat $CWM_CONFIGFILE`
    STD_IFS=$IFS
    IFS=$'\n'
    for d in $CONFIG; do

        key=$(echo $d | cut -f1 -d"=")
        value=$(echo $d | cut -f2 -d"=")
        export "CWM_${key^^}"="$value"

    done
    IFS=$STD_IFS

    # additional cwm global params
    export ADMINEMAIL=$CWM_EMAIL
    export ADMINPASSWORD="$CWM_PASSWORD"
    export CWM_WANNICIDS=($(cat $CWM_CONFIGFILE | grep ^vlan.*=wan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"))
    export CWM_LANNICIDS=($(cat $CWM_CONFIGFILE | grep ^vlan.*=lan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"))
    # export CWM_DISKS=`cat $CWM_CONFIGFILE | grep ^disk.*size=.* | wc -l`
    export CWM_UUID=$(cat /sys/class/dmi/id/product_serial | cut -d '-' -f 2,3 | tr -d ' -' | sed 's/./&-/20;s/./&-/16;s/./&-/12;s/./&-/8')
    export CWM_SERVERIP="$(getServerIP)"
    export CWM_DOMAIN="${CWM_SERVERIP//./-}.cloud-xip.io"
    export CWM_DISPLAYED_ADDRESS=${CWM_SERVERIP}

    touch $rootDir/temp/globals-set.success
fi

if [ -f "$rootDir/temp/global-domain-set.success" ]; then

    export CWM_DISPLAYED_ADDRESS=${CWM_DOMAIN}

fi

# fail install if cwm api key or secret is missing
if [ -z "$CWM_NO_API_KEY" ] && [[ -z "$CWM_APICLIENTID" || -z "$CWM_APISECRET" ]]; then

    echo "No CWM API Client ID or Secret is set. Exiting." | tee -a ${CWM_ERRORFILE}
    exit 1

fi

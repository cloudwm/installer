#!/bin/bash

if [ -f "$CWMCONFIGFILE" ];
then

CONFIG=`cat $CWMCONFIGFILE`

IFS=$'\n'

for d in $CONFIG; 
do

    export `echo $d | cut -f 1 -d"="`="`echo $d | cut -f 2 -d"="`"

done

CWMSITE=$url
ADMINEMAIL=$email
ADMINPASSWORD=$password
ZONE=$zone
VMNAME=$name
WANNICIDS=`cat $CWMCONFIGFILE | grep ^vlan.*=wan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"`
LANNICIDS=`cat $CWMCONFIGFILE | grep ^vlan.*=lan-.* | cut -f 1 -d"=" | cut -f 2 -d"n"`
DISKS=`cat $CWMCONFIGFILE | grep ^disk.*size=.* | wc -l`
UUID=`cat /sys/class/dmi/id/product_uuid | tr '[:upper:]' '[:lower:]'`

var=0

for nicid in $WANNICIDS;
do

    var=$((var+1))
    nicvar=ip${nicid}
    export `echo WANIP$var`=`echo ${!nicvar}`
    unset nicvar

done

var=0

for nicid in $LANNICIDS;
do

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

    if [[ ! -z "$apiClientId" && ! -z "$apiSecret" ]];
    then

        curl -f -X PUT -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}"  "https://$CWMSITE/svc/server/$UUID/description" -d $'description='"$1"
        errorCode=$?

        if [ $errorCode != '0' ]; 
        then
		echo "Erorr updating server description" | log

	else 

	    echo "Updated Overview->Description data for $UUID" | log
        fi

    else

	echo "No API Client ID or Secret is set, description not set" | log

    fi

}


function getServerDescription() {

    if [[ ! -z "$apiClientId" && ! -z "$apiSecret" ]];
    then

        description=`curl -f -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}" "https://$CWMSITE/svc/server/$UUID/overview" | grep -Po '(?<="description":")(.*?)(?=",")'`
        errorCode=$?

        if [ $errorCode != '0' ]; 
        then
                echo "Erorr retrieving server overview"

        else 

            echo -e $description
        fi

    else

        echo "No API Client ID or Secret is set, unable to retrieve server overview"

    fi

}

function appendServerDescription() {

    description=`getServerDescription`
    updateServerDescription "$description $1"

}

function appendServerDescriptionTXT() {

   rootDir=$(rootDir)
   file=$rootDir/DESCRIPTION.TXT

    if [ -f "$file" ];
    then

        fileContent=`cat $file`

    fi

    description=`getServerDescription`
    updateServerDescription "$description $fileContent"

}

function setServerDescriptionTXT() {

   rootDir=$(rootDir)
   file=$rootDir/DESCRIPTION.TXT

    if [ -f "$file" ];
    then

        fileContent=`cat $file`

    fi

    updateServerDescription "$fileContent"

}

function getServerIP() {

    IPS=`cat $1 | grep ^ip.*=* | cut -f 2 -d"i" | cut -f 2 -d"p"`

    if [ -z "$IPS" ]
    then
        hostname -I
        return 0
    fi

    if [ ! -z "$WANNICIDS" ]
    then
        index=`echo $WANNICIDS | awk '{print $1;}'`
        index=$((index+1))
        echo $IPS | awk -v a="$index" '{print $a;}' | cut -f 2 -d"="
        return 0
    fi

    if [ ! -z "$LANNICIDS" ]
    then
        index=`echo $LANNICIDS | awk '{print $1;}'`
        index=$((index+1))
        echo $IPS | awk -v a="$index" '{print $a;}' | cut -f 2 -d"="
        return 0
    fi

}

SERVERIP="$(getServerIP $CWMCONFIGFILE)"

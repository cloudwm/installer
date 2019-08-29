#!/bin/bash

# collect params
CWMSITE=URL_PLACEHOLDER
PARENTUUID=ID_PLACEHOLDER
UUID=$(cat /sys/class/dmi/id/product_serial | cut -d '-' -f 2,3 | tr -d ' -' | sed 's/./&-/20;s/./&-/16;s/./&-/12;s/./&-/8')
apiClientId=`cat /root/guest.conf | grep apiClientId | cut -d '=' -f 2`
apiSecret=`cat /root/guest.conf | grep apiSecret | cut -d '=' -f 2`
description=`cat /root/DESCRIPTION.TXT`

# update server description
curl -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}" -X PUT --url "https://${CWMSITE}/svc/server/${UUID}/description" --data-urlencode $'description='"${description}"

sleep 15 
# terminate parent bootstrapper
# curl -H "AuthClientId: ${apiClientId}" -H "AuthSecret:${apiSecret} " -X PUT -d "power=off" --url "https://${CWMSITE}/service/server/${PARENTUUID}/power"
curl -H "AuthClientId: ${apiClientId}" -H "AuthSecret: ${apiSecret}" -X DELETE -d "confirm=1" -d "force=1" --url "https://${CWMSITE}/service/server/${PARENTUUID}/terminate"
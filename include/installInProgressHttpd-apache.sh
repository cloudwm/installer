#!/bin/bash

# Add this at the begining of all scripts.
if [ -f "include/startup.sh" ]; then
    . include/startup.sh
elif [ -f "../include/startup.sh" ]; then
    . ../include/startup.sh
fi

echo "Installing Figlet..."
apt update && apt install -y figlet

appPath=/etc/apache2/sites-available/
figletApp=$(which figlet)

if [ ! -d "$appPath" ]; then
    echo "Web server directory doesn't exist, exiting." | log 1
    exit 1
fi

if [ -f "$appPath/redmine.conf" ]; then
    echo "redmine.conf file exists. Skipping." | log
    tagScript success
    exit 99
fi

if [ -z "$figletApp" ]; then
    echo "Figlet is not installed, please install figlet." | log 1
    exit 1
fi

echo "Adding 'Install in Progress' notice to $appPath/index.html" | log
echo "<html><head><title>Installation Progress</title></head><body><pre align='center'>" > "$appPath/index.html"
$figletApp "Install in Progress" >> "$appPath/index.html"
echo "Please Wait. Application and services installation is in progress, the process will take a couple of minutes to complete. Thank you for your patience. Refresh the page within a couple of minutes for an updated status." >> "$appPath/index.html"
echo "</pre></body></html>" >> "$appPath/index.html"


tagScript success
exit 0

#!/bin/bash

if [ -f "include/startup.sh" ]; then
    . include/startup.sh
elif [ -f "../include/startup.sh" ]; then
    . ../include/startup.sh
fi

installPackage apache2
installPackage libapache2-mod-passenger

cat <<_EOF_ > /etc/apache2/sites-available/redmine.conf
<VirtualHost *:80>
    ServerName redmine.omc
    DocumentRoot ${REPO_DIR}/public
    <Directory ${REPO_DIR}/public>
        Allow from all
        Options -MultiViews
        Require all granted
    </Directory>
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName redmine.omc
    DocumentRoot ${REPO_DIR}/public

    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/apache-selfsigned.crt
    SSLCertificateKeyFile /etc/ssl/private/apache-selfsigned.key

    <Directory ${REPO_DIR}/public>
        Allow from all
        Options -MultiViews
        Require all granted
    </Directory>
</VirtualHost>
</IfModule>
_EOF_

tag apache.success
tag httpd.success
tagScript success

exit 0
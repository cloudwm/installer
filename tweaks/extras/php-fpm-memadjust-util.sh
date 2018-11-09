### basic check php-fpm existence

service=$(systemctl | grep fpm | awk '{print $1}')

if [[ -z "$service" ]];then
        echo php-fpm is not installed
        exit 1
fi


### provision.sh variables
ramreserve=1024
ramphpfpm=85
minphpfpm=6

### Configuring php-fpm file ###

ini=$(find /etc -type f -name "php.ini" | grep fpm)
fpmini=$(find /etc -type f -name "www.conf")

### read system resources ###

ram=$(i=$(awk 'NR==1{print $2}' /proc/meminfo) && expr $i / 1000)
#cpu=`nproc`

### read current settings in php.ini

currentmem=`awk '/memory_limit/' $ini`

### override settings of this script ###

overridemem=`awk '!/#/' /scripts/php.ini | awk '/memory/'`
overridemaxchild=`awk '!/#/' /scripts/php.ini | awk '/pm.max_children/'`
overridestartsrv=`awk '!/#/' /scripts/php.ini | awk '/pm.start_servers/'`
overrideminsparesrv=`awk '!/#/' /scripts/php.ini | awk '/pm.min_spare_servers/'`
overridemaxsparesrv=`awk '!/#/' /scripts/php.ini | awk '/pm.max_spare_servers/'`

### read fpm settings ###

maxchild=`awk '/pm.max_children =/' $fpmini`
startsrv=`awk '/pm.start_servers =/' $fpmini`
minsparesrv=`awk '/pm.min_spare_servers =/' $fpmini`
maxsparesrv=`awk '/pm.max_spare_servers =/' $fpmini`

### Calculate fpm settings ###

if [ $ram -ge 2048 ]

then

        calc=$(expr $ram - $ramreserve)
        recommended=$(expr $calc / $ramphpfpm)

else

        recommended=$minphpfpm

fi

echo $recommended is recommended value
calcmin=$(expr $recommended \* 20 / 100)

###

if [ -z "$overridemaxchild" ];
then
        echo setting pm.max_children = $recommended
        sed -i "s/$maxchild/pm.max_children = $recommended/g" $fpmini
else
        sed -i "s/$maxchild/$overridemaxchild/g" $fpmini
fi

if [ -z "$overridestartsrv" ];
then
        echo setting pm.start_servers = $calcmin
        sed -i "s/$startsrv/pm.start_servers = $calcmin/g" $fpmini
else
        sed -i "s/$startsrv/$overridestartsrv/g" $fpmini
fi


if [ -z "$overrideminsparesrv" ];
then
        echo setting pm.min_spare_server = $calcmin
        sed -i "s/$minsparesrv/pm.min_spare_servers = $calcmin/g" $fpmini
else
        sed -i "s/$minsparesrv/$overrideminsparesrv/g" $fpmini
fi

if [ -z "$overridemaxsparesrv" ];
then
        echo setting pm.max_spare_servers = $recommended
        sed -i "s/$maxsparesrv/pm.max_spare_servers = $recommended/g" $fpmini
else
        sed -i "s/$maxsparesrv/$overridemaxsparesrv/g" $fpmini
fi

systemctl restart $service

### Auto set Memory limit ###

recommendedlimit=$(expr $ram / 8 )M

if [ -z "$overridemem" ];
then

        echo You have ${ram} of RAM
        echo settings memory_limit to ${recommendedlimit}
        sed -i "s/$currentmem/memory_limit = $recommendedlimit/g" $ini
        systemctl restart $service

else
        echo Settings have been overriden
        echo setting memory_limit to $overridemem
        sed -i "s/$currentmem/$overridemem/g" $ini
fi

exit 0


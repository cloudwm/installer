# Tasks
    - mod: phpmyadmin-nginx-redirecthttptohttps manual writing to nginx config
	
	- CERTBOT for magento
	
    + אני רואה שיש ב- apps גם גרסה של magento-nginx וגם 2.3.0-nginx - תוריד את מה שלא צריך
	
    + בנוסף, הקובץ 2.3.0 - צריך לעשות לו chmod 755 כדי שאפשר יהיה להריץ אותו
	
    + אני רואה שהוספת שהוא מוסיף לקבצים +x לכולם - צריך להוריד את זה, זה לא נכון.
	
    + אני רואה שעשית לו INCLUDE - זה לא טוב. וגם צריך להוריד אותו משם.. אתה צריך להכניס אותו לקובץ שלנו. "HARD CODED"
	
    - עוד משהו, בקובץ DESCRIPTION - הלקוח אמור לראות הכל, צריך להוסיף לשם את ה- URL המלא להתחברות, שם משתמש ל- ADMIN, סיסמא של ה- ADMIN של ה- MAGENTO, את ה- URL המלא להגלישה באתר.
   
	+ cp $rootDir/tweaks/extras/magento-nginx/magento-nginx-config /etc/nginx/sites-available/magento | log פה - אין משמעות ל- LOG - בפועל זה לא מציג כלום, כן? אתה צריך להכניס לפי זה שורה עם echo שאליה אתה עושה LOG. אפשר לעשות את זה במקום ה- COMMENT..

    + cd /var/www/html/ && composer install -v | log
	
    + ודבר נוסף אחרון, אני רואה שיש כאן בסקריפט server_ip. 
	תכניס ב- startup.sh בסוף, 
	שהוא מאתר את הכתובת IP ה- WAN של השרת מתוך המשתנשים שב- startup-cwm.sh, 
	והוא מזהה אם יש כתובת WAN - אז היא מוגדרת ככתובת WAN, 
	ואם יש רק כתובת LAN - אז הוא מציג את ה- כתובת LAN, 
	ואם אין כתובת מה- guest.conf - אז שיוציא מהכרטיס רשת של המכונה. 
	כדי שלא נרשום את זה בכל סקריפט, 
	והוא צריך להיות מוגדר כ- "SERVERIP" (באותיות גדולות).


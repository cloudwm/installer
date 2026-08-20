#!/bin/bash
# HAProxy 3.3 install verification
D=$(grep '^fqdn0=' /root/guest.conf | cut -d= -f2)
P=$(grep '^password=' /root/guest.conf | cut -d= -f2)
ok(){ printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
t(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

echo "== 1. שירותים =="
t "haproxy רץ"                'systemctl is-active --quiet haproxy'
t "haproxy יעלה אחרי reboot"  'systemctl is-enabled --quiet haproxy'
t "dataplaneapi רץ"           'systemctl is-active --quiet dataplaneapi'
t "dataplaneapi יעלה אחרי reboot" 'systemctl is-enabled --quiet dataplaneapi'
t "nginx כבוי (לא חוטף פורט 80)" '! systemctl is-enabled --quiet nginx'

echo "== 2. קונפיג ותעודה =="
t "haproxy.cfg תקין"          'haproxy -c -f /etc/haproxy/haproxy.cfg'
t "אין placeholder שנשאר"     '! grep -q PLACEHOLDER /etc/haproxy/haproxy.cfg'
t "PEM מכיל תעודה+מפתח"       'grep -q "BEGIN CERTIFICATE" /etc/letsencrypt/live/'"$D"'/haproxy-fullcert.pem && grep -q "PRIVATE KEY" /etc/letsencrypt/live/'"$D"'/haproxy-fullcert.pem'
t "התעודה תואמת לדומיין"      'openssl x509 -in /etc/letsencrypt/live/'"$D"'/fullchain.pem -noout -text | grep -q "'"$D"'"'
t "התעודה בתוקף"              'openssl x509 -in /etc/letsencrypt/live/'"$D"'/fullchain.pem -noout -checkend 0'

echo "== 3. פורטים =="
for p in 80 8404 5555; do t "מאזין על $p" "ss -tln | grep -q ':$p '"; done
t "ufw פתוח ל-8404"           'ufw status | grep -q "^8404 "'

echo "== 4. תגובות בפועל =="
c=$(curl -sk -o /dev/null -w '%{http_code}' -u "admin:$P" "https://127.0.0.1:8404/stats"); [ "$c" = 200 ] && ok "Stats UI מחזיר 200" || bad "Stats UI מחזיר $c"
c=$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:8404/stats");            [ "$c" = 401 ] && ok "Stats UI דורש סיסמה (401)" || bad "Stats UI לא מוגן! ($c)"
c=$(curl -s  -o /dev/null -w '%{http_code}' -u 'admin:Omci1234!' "http://127.0.0.1:5555/v2/services/haproxy/configuration/global"); [ "$c" = 200 ] && ok "DataPlane API מחזיר 200" || bad "DataPlane API מחזיר $c"
c=$(curl -s  -o /dev/null -w '%{http_code}' "http://127.0.0.1/");                       [ "$c" = 302 ] && ok "פורט 80 מפנה ל-https (302)" || bad "פורט 80 מחזיר $c"

echo "== 5. חידוש תעודה =="
t "update-certs.sh קיים+ריצה"  '[ -x /opt/update-certs.sh ]'
t "אין certbot רקורסיבי בהוק"  '! grep -q "certbot .*renew" /opt/update-certs.sh'
t "post-hook מחובר"            'grep -q "post-hook.*update-certs.sh" /lib/systemd/system/certbot.service'
t "pre-hook משחרר פורט 80"     'grep -q "pre-hook .systemctl stop haproxy." /lib/systemd/system/certbot.service'
t "ההוק מחזיר את haproxy"      'grep -q "systemctl start haproxy" /opt/update-certs.sh'
t "certbot.timer פעיל"         'systemctl is-active --quiet certbot.timer'

echo "== 6. tweaks מהקונפיג =="
t "אזור זמן לא UTC"           '! timedatectl | grep -q "Time zone: Etc/UTC"'
t "snapd הוסר"                '! dpkg -l snapd 2>/dev/null | grep -q "^ii"'
t "swappiness הוגדר"          '[ "$(sysctl -n vm.swappiness)" != 60 ]'

echo; echo "== מידע =="
echo "  Stats UI:  https://$D:8404/stats   (admin / $P)"
echo "  גרסה:      $(haproxy -v | head -1 | cut -d, -f1)"
